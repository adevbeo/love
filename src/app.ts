import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, extname, normalize, resolve } from "node:path";
import { Readable } from "node:stream";

import type { AppConfig } from "./config.ts";
import { loadConfig } from "./config.ts";
import { issueAccessToken, issueRefreshToken, type AccessTokenClaims, type RefreshTokenClaims, generateTemporaryPassword, hashPassword, randomId, sha256, verifyJwt, verifyPassword } from "./crypto.ts";
import { AppStore } from "./db.ts";
import {
  DEFAULT_APP_CONTENT,
  SUPPORTED_AUDIO_MIME_TYPES,
  SUPPORTED_IMAGE_MIME_TYPES,
  type CoupleAccount,
  type CoupleMember
} from "./domain.ts";
import { HttpError, isHttpError } from "./errors.ts";
import {
  normalizeEmail,
  validateAppContentCatalog,
  validateLoginPayload,
  validatePasswordChangePayload,
  validateRefreshPayload,
  validateRegisterPayload,
  validateResetRequestPayload,
  validateSnapshotPayload
} from "./validators.ts";

interface RequestContext {
  remoteAddress: string;
}

interface AuthContext {
  member: CoupleMember;
  couple: CoupleAccount;
  claims: AccessTokenClaims;
}

interface RateLimitRule {
  limit: number;
  windowMs: number;
}

type ServerlessHeaders = Headers | IncomingHttpHeaders | Record<string, string | string[] | undefined> | undefined;

type ServerlessRequestLike = {
  headers?: ServerlessHeaders;
  url?: string;
};

function responseHeaders(config: AppConfig, extraHeaders: HeadersInit = {}): Headers {
  const headers = new Headers(extraHeaders);
  headers.set("Access-Control-Allow-Origin", config.corsOrigin);
  headers.set("Access-Control-Allow-Headers", "authorization, content-type");
  headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  headers.set("Cache-Control", "no-store");
  return headers;
}

function jsonResponse(config: AppConfig, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(config, {
      "Content-Type": "application/json; charset=utf-8"
    })
  });
}

function emptyResponse(config: AppConfig, status = 204): Response {
  return new Response(null, {
    status,
    headers: responseHeaders(config)
  });
}

async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Body JSON khong hop le");
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function addSecondsToIso(baseIso: string, seconds: number): string {
  return new Date(Date.parse(baseIso) + seconds * 1000).toISOString();
}

function extensionFromMime(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "audio/m4a":
      return "m4a";
    case "audio/mp4":
      return "mp4";
    case "audio/aac":
      return "aac";
    case "audio/mpeg":
      return "mp3";
    default:
      return "bin";
  }
}

function mimeFromPath(pathname: string): string {
  switch (extname(pathname).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".m4a":
      return "audio/m4a";
    case ".mp4":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".mp3":
      return "audio/mpeg";
    default:
      return "application/octet-stream";
  }
}

function sanitizeUploadPath(uploadRoot: string, relativePath: string): string {
  const safeRelative = normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, "");
  const absolutePath = resolve(uploadRoot, safeRelative);
  const normalizedRoot = resolve(uploadRoot);

  if (!absolutePath.startsWith(normalizedRoot)) {
    throw new HttpError(404, "MEDIA_NOT_FOUND", "Khong tim thay file");
  }

  return absolutePath;
}

export class LoveApiServer {
  readonly config: AppConfig;
  readonly store: AppStore;
  private readonly rateLimits = new Map<string, { count: number; resetAt: number }>();
  private server?: Server;

  constructor(config: AppConfig = loadConfig()) {
    this.config = config;
    this.store = new AppStore(config);
  }

  async listen(port = this.config.port): Promise<Server> {
    if (this.server) {
      return this.server;
    }

    this.server = createServer((req, res) => {
      this.handleNodeRequest(req, res).catch((error) => {
        const response = this.errorResponse(error);
        this.writeNodeResponse(res, response).catch((writeError) => {
          console.error("response_write_failed", writeError);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.end("internal server error");
          }
        });
      });
    });

    return await new Promise<Server>((resolveServer) => {
      this.server!.listen(port, () => resolveServer(this.server!));
    });
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;

    await new Promise<void>((resolveClose) => {
      if (!server) {
        resolveClose();
        return;
      }

      server.close(() => resolveClose());
    });

    this.store.close();
  }

  async inject(params: {
    method?: string;
    path: string;
    headers?: HeadersInit;
    body?: BodyInit | null;
    remoteAddress?: string;
  }): Promise<Response> {
    const method = params.method ?? "GET";
    const hasBody = params.body !== undefined && params.body !== null;
    const request = new Request(new URL(params.path, this.config.publicBaseUrl), {
      method,
      headers: params.headers,
      body: hasBody ? params.body : undefined,
      duplex: hasBody ? "half" : undefined
    });

    return this.handle(request, {
      remoteAddress: params.remoteAddress ?? "127.0.0.1"
    });
  }

  async handle(request: Request, context: Partial<RequestContext> = {}): Promise<Response> {
    try {
      return await this.handleRequest(request, {
        remoteAddress: context.remoteAddress ?? "unknown"
      });
    } catch (error) {
      return this.errorResponse(error);
    }
  }

  private async handleNodeRequest(req: IncomingMessage, res: ServerResponse) {
    const request = this.toWebRequest(req);
    const response = await this.handle(request, {
      remoteAddress: req.socket.remoteAddress ?? "unknown"
    });
    await this.writeNodeResponse(res, response);
  }

  private toWebRequest(req: IncomingMessage): Request {
    const method = req.method ?? "GET";
    const origin = this.config.publicBaseUrl.replace(/\/$/, "");
    const url = new URL(req.url ?? "/", origin);
    const hasBody = !["GET", "HEAD"].includes(method);

    return new Request(url, {
      method,
      headers: req.headers as HeadersInit,
      body: hasBody ? (Readable.toWeb(req) as ReadableStream<Uint8Array>) : undefined,
      duplex: hasBody ? "half" : undefined
    });
  }

  private async writeNodeResponse(res: ServerResponse, response: Response) {
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    if (!response.body) {
      res.end();
      return;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    res.end(buffer);
  }

  private errorResponse(error: unknown): Response {
    if (isHttpError(error)) {
      return jsonResponse(
        this.config,
        {
          error: error.message,
          code: error.code,
          details: error.details ?? undefined
        },
        error.status
      );
    }

    console.error("unhandled_error", error);
    return jsonResponse(
      this.config,
      {
        error: "Loi he thong",
        code: "INTERNAL_SERVER_ERROR"
      },
      500
    );
  }

  private applyRateLimit(name: string, remoteAddress: string, rule: RateLimitRule) {
    const now = Date.now();
    const key = `${name}:${remoteAddress}`;
    const existing = this.rateLimits.get(key);

    if (!existing || existing.resetAt <= now) {
      this.rateLimits.set(key, {
        count: 1,
        resetAt: now + rule.windowMs
      });
      return;
    }

    if (existing.count >= rule.limit) {
      throw new HttpError(429, "RATE_LIMITED", "Qua nhieu request, vui long thu lai sau");
    }

    existing.count += 1;
    this.rateLimits.set(key, existing);
  }

  private buildSession(member: CoupleMember, couple: CoupleAccount, accessToken: string, refreshToken: string) {
    return {
      accessToken,
      refreshToken,
      requiresPasswordChange: member.requiresPasswordChange,
      user: {
        id: member.id,
        email: member.email,
        displayName: member.displayName,
        requiresPasswordChange: member.requiresPasswordChange
      },
      couple: {
        id: couple.id,
        label: couple.label,
        primaryEmail: couple.primaryEmail,
        secondaryEmail: couple.secondaryEmail
      }
    };
  }

  private requireAuth(request: Request, options: { allowPendingPasswordChange?: boolean } = {}): AuthContext {
    const authorizationHeader = request.headers.get("authorization");
    if (!authorizationHeader?.startsWith("Bearer ")) {
      throw new HttpError(401, "AUTH_MISSING_TOKEN", "Thieu access token");
    }

    const token = authorizationHeader.slice("Bearer ".length);
    const claims = verifyJwt<AccessTokenClaims>(token, this.config.jwtAccessSecret);

    if (claims.type !== "access") {
      throw new HttpError(401, "AUTH_INVALID_TOKEN", "Token khong hop le");
    }

    const member = this.store.findMemberById(claims.sub);
    const couple = member ? this.store.findCoupleById(member.coupleId) : null;

    if (!member || !couple) {
      throw new HttpError(401, "AUTH_INVALID_TOKEN", "Token khong hop le");
    }

    if (member.status !== "active" || couple.status !== "active") {
      throw new HttpError(403, "AUTH_ACCOUNT_DISABLED", "Tai khoan khong con hoat dong");
    }

    if (!options.allowPendingPasswordChange && member.requiresPasswordChange) {
      throw new HttpError(
        403,
        "AUTH_PASSWORD_CHANGE_REQUIRED",
        "Tai khoan phai doi mat khau truoc khi truy cap du lieu"
      );
    }

    return {
      member,
      couple,
      claims
    };
  }

  private async handleRequest(request: Request, context: RequestContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === "OPTIONS") {
      return emptyResponse(this.config);
    }

    if (request.method === "GET" && pathname === "/api/health") {
      return jsonResponse(this.config, {
        status: "ok",
        time: nowIso()
      });
    }

    if (request.method === "GET" && pathname === "/api/app-content") {
      const appContent = this.store.getActiveAppContent();
      if (!appContent) {
        throw new HttpError(500, "APP_CONTENT_MISSING", "Chua seed app-content");
      }

      return jsonResponse(this.config, { appContent });
    }

    if (request.method === "POST" && pathname === "/api/auth/register-couple") {
      return this.handleRegisterCouple(request, context);
    }

    if (request.method === "POST" && pathname === "/api/auth/login") {
      return this.handleLogin(request, context);
    }

    if (request.method === "POST" && pathname === "/api/auth/refresh") {
      return this.handleRefresh(request);
    }

    if (request.method === "POST" && pathname === "/api/auth/request-reset") {
      return this.handleRequestReset(request, context);
    }

    if (
      request.method === "POST" &&
      (pathname === "/api/auth/complete-password-change" || pathname === "/api/auth/change-password")
    ) {
      return this.handleCompletePasswordChange(request);
    }

    if (request.method === "GET" && pathname === "/api/couple-space") {
      return this.handleGetCoupleSpace(request);
    }

    if (request.method === "PUT" && pathname === "/api/couple-space") {
      return this.handlePutCoupleSpace(request);
    }

    if (request.method === "POST" && pathname === "/api/media/upload") {
      return this.handleMediaUpload(request, context);
    }

    if (request.method === "GET" && pathname.startsWith("/uploads/")) {
      return this.handleReadUpload(pathname.slice("/uploads/".length));
    }

    throw new HttpError(404, "NOT_FOUND", "Khong tim thay endpoint");
  }

  private async handleRegisterCouple(request: Request, context: RequestContext): Promise<Response> {
    this.applyRateLimit("register", context.remoteAddress, { limit: 5, windowMs: 10 * 60 * 1000 });

    const { primaryEmail, secondaryEmail, label } = validateRegisterPayload(await readJsonBody(request));
    const primaryNormalized = normalizeEmail(primaryEmail);
    const secondaryNormalized = normalizeEmail(secondaryEmail);

    if (this.store.findMemberByEmailNormalized(primaryNormalized) || this.store.findMemberByEmailNormalized(secondaryNormalized)) {
      throw new HttpError(409, "AUTH_EMAIL_EXISTS", "Mot trong hai email da ton tai");
    }

    const tempPassword = generateTemporaryPassword();
    const passwordHash = hashPassword(tempPassword);
    const now = nowIso();

    try {
      const result = this.store.transaction(() => {
        const couple = this.store.insertCoupleAccount({
          primaryEmail,
          secondaryEmail,
          label,
          now
        });
        const primaryMember = this.store.insertCoupleMember({
          coupleId: couple.id,
          email: primaryEmail,
          emailNormalized: primaryNormalized,
          passwordHash,
          now
        });
        const secondaryMember = this.store.insertCoupleMember({
          coupleId: couple.id,
          email: secondaryEmail,
          emailNormalized: secondaryNormalized,
          passwordHash,
          now
        });

        const emailJobs = [
          this.store.insertEmailJob({
            memberId: primaryMember.id,
            coupleId: couple.id,
            recipientEmail: primaryMember.email,
            template: "temporary-password",
            payload: {
              tempPassword,
              requiresPasswordChange: true,
              mailFrom: this.config.mailFrom,
              label: couple.label
            },
            now
          }),
          this.store.insertEmailJob({
            memberId: secondaryMember.id,
            coupleId: couple.id,
            recipientEmail: secondaryMember.email,
            template: "temporary-password",
            payload: {
              tempPassword,
              requiresPasswordChange: true,
              mailFrom: this.config.mailFrom,
              label: couple.label
            },
            now
          })
        ];

        this.store.insertAuditLog({
          memberId: null,
          coupleId: couple.id,
          action: "auth.register_couple",
          metadata: {
            primaryEmail,
            secondaryEmail
          },
          now
        });

        return {
          couple,
          emailJobs
        };
      });

      return jsonResponse(
        this.config,
        {
          couple: result.couple,
          emailJobsQueued: result.emailJobs.length
        },
        201
      );
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        throw new HttpError(409, "AUTH_EMAIL_EXISTS", "Mot trong hai email da ton tai");
      }
      throw error;
    }
  }

  private async handleLogin(request: Request, context: RequestContext): Promise<Response> {
    this.applyRateLimit("login", context.remoteAddress, { limit: 10, windowMs: 10 * 60 * 1000 });

    const { email, password } = validateLoginPayload(await readJsonBody(request));
    const member = this.store.findMemberByEmailNormalized(normalizeEmail(email));
    const now = nowIso();

    if (!member || !verifyPassword(password, member.passwordHash)) {
      this.store.insertAuditLog({
        memberId: member?.id ?? null,
        coupleId: member?.coupleId ?? null,
        action: "auth.login_failed",
        metadata: {
          email: normalizeEmail(email)
        },
        now
      });
      throw new HttpError(401, "AUTH_INVALID_CREDENTIALS", "Email hoac mat khau khong dung");
    }

    const couple = this.store.findCoupleById(member.coupleId);
    if (!couple || member.status !== "active" || couple.status !== "active") {
      throw new HttpError(403, "AUTH_ACCOUNT_DISABLED", "Tai khoan khong con hoat dong");
    }

    const access = issueAccessToken(this.config, {
      sub: member.id,
      coupleId: couple.id,
      email: member.email
    });
    const refresh = issueRefreshToken(this.config, {
      sub: member.id,
      coupleId: couple.id,
      email: member.email
    });
    const expiresAt = addSecondsToIso(now, this.config.jwtRefreshTtlSeconds);

    this.store.transaction(() => {
      this.store.touchMemberLogin(member.id, now);
      this.store.insertRefreshToken({
        memberId: member.id,
        coupleId: couple.id,
        jwtId: refresh.claims.jti,
        tokenHash: sha256(refresh.token),
        expiresAt,
        now
      });
      this.store.insertAuditLog({
        memberId: member.id,
        coupleId: couple.id,
        action: "auth.login_success",
        metadata: {
          email: member.email,
          requiresPasswordChange: member.requiresPasswordChange
        },
        now
      });
    });

    return jsonResponse(this.config, {
      session: this.buildSession(member, couple, access.token, refresh.token)
    });
  }

  private async handleRefresh(request: Request): Promise<Response> {
    const { refreshToken } = validateRefreshPayload(await readJsonBody(request));
    const claims = verifyJwt<RefreshTokenClaims>(refreshToken, this.config.jwtRefreshSecret);

    if (claims.type !== "refresh") {
      throw new HttpError(401, "AUTH_INVALID_TOKEN", "Refresh token khong hop le");
    }

    const tokenHash = sha256(refreshToken);
    const tokenRecord = this.store.findRefreshTokenByHash(tokenHash);
    if (!tokenRecord || tokenRecord.revokedAt || tokenRecord.jwtId !== claims.jti) {
      throw new HttpError(401, "AUTH_INVALID_REFRESH_TOKEN", "Refresh token khong hop le");
    }

    if (Date.parse(tokenRecord.expiresAt) <= Date.now()) {
      throw new HttpError(401, "AUTH_TOKEN_EXPIRED", "Refresh token da het han");
    }

    const member = this.store.findMemberById(tokenRecord.memberId);
    const couple = member ? this.store.findCoupleById(member.coupleId) : null;
    if (!member || !couple || member.status !== "active" || couple.status !== "active") {
      throw new HttpError(403, "AUTH_ACCOUNT_DISABLED", "Tai khoan khong con hoat dong");
    }

    const now = nowIso();
    const access = issueAccessToken(this.config, {
      sub: member.id,
      coupleId: couple.id,
      email: member.email
    });
    const refresh = issueRefreshToken(this.config, {
      sub: member.id,
      coupleId: couple.id,
      email: member.email
    });

    this.store.transaction(() => {
      this.store.revokeRefreshToken(tokenHash, now);
      this.store.insertRefreshToken({
        memberId: member.id,
        coupleId: couple.id,
        jwtId: refresh.claims.jti,
        tokenHash: sha256(refresh.token),
        expiresAt: addSecondsToIso(now, this.config.jwtRefreshTtlSeconds),
        now
      });
      this.store.insertAuditLog({
        memberId: member.id,
        coupleId: couple.id,
        action: "auth.refresh",
        metadata: {},
        now
      });
    });

    return jsonResponse(this.config, {
      session: this.buildSession(member, couple, access.token, refresh.token)
    });
  }

  private async handleRequestReset(request: Request, context: RequestContext): Promise<Response> {
    this.applyRateLimit("request-reset", context.remoteAddress, { limit: 5, windowMs: 10 * 60 * 1000 });

    const { email } = validateResetRequestPayload(await readJsonBody(request));
    const member = this.store.findMemberByEmailNormalized(normalizeEmail(email));
    const now = nowIso();

    if (member) {
      const tempPassword = generateTemporaryPassword();
      const passwordHash = hashPassword(tempPassword);

      this.store.transaction(() => {
        this.store.updateMemberPasswordForReset(member.id, passwordHash, now);
        this.store.revokeAllRefreshTokensForMember(member.id, now);
        this.store.insertEmailJob({
          memberId: member.id,
          coupleId: member.coupleId,
          recipientEmail: member.email,
          template: "password-reset",
          payload: {
            tempPassword,
            requiresPasswordChange: true,
            mailFrom: this.config.mailFrom
          },
          now
        });
        this.store.insertAuditLog({
          memberId: member.id,
          coupleId: member.coupleId,
          action: "auth.password_reset_requested",
          metadata: {
            email: member.email
          },
          now
        });
      });
    }

    return jsonResponse(this.config, {
      message: "Neu email ton tai, mat khau tam da duoc xep hang gui di"
    });
  }

  private async handleCompletePasswordChange(request: Request): Promise<Response> {
    const auth = this.requireAuth(request, {
      allowPendingPasswordChange: true
    });
    const { newPassword } = validatePasswordChangePayload(await readJsonBody(request), this.config.passwordMinLength);

    if (verifyPassword(newPassword, auth.member.passwordHash)) {
      throw new HttpError(422, "AUTH_REUSED_PASSWORD", "Mat khau moi phai khac mat khau hien tai");
    }

    const now = nowIso();
    const passwordHash = hashPassword(newPassword);
    const access = issueAccessToken(this.config, {
      sub: auth.member.id,
      coupleId: auth.couple.id,
      email: auth.member.email
    });
    const refresh = issueRefreshToken(this.config, {
      sub: auth.member.id,
      coupleId: auth.couple.id,
      email: auth.member.email
    });

    this.store.transaction(() => {
      this.store.completePasswordChange(auth.member.id, passwordHash, now);
      this.store.revokeAllRefreshTokensForMember(auth.member.id, now);
      this.store.insertRefreshToken({
        memberId: auth.member.id,
        coupleId: auth.couple.id,
        jwtId: refresh.claims.jti,
        tokenHash: sha256(refresh.token),
        expiresAt: addSecondsToIso(now, this.config.jwtRefreshTtlSeconds),
        now
      });
      this.store.insertAuditLog({
        memberId: auth.member.id,
        coupleId: auth.couple.id,
        action: "auth.password_change_completed",
        metadata: {},
        now
      });
    });

    const member = this.store.findMemberById(auth.member.id);
    if (!member) {
      throw new HttpError(500, "INTERNAL_SERVER_ERROR", "Khong the tai lai thong tin user");
    }

    return jsonResponse(this.config, {
      session: this.buildSession(member, auth.couple, access.token, refresh.token)
    });
  }

  private handleGetCoupleSpace(request: Request): Response {
    const auth = this.requireAuth(request);
    const snapshot = this.store.getSnapshotByCoupleId(auth.couple.id);
    return jsonResponse(this.config, {
      snapshot
    });
  }

  private async handlePutCoupleSpace(request: Request): Promise<Response> {
    const auth = this.requireAuth(request);
    const { schemaVersion, content } = validateSnapshotPayload(await readJsonBody(request));
    const now = nowIso();

    const snapshot = this.store.transaction(() => {
      const storedSnapshot = this.store.putSnapshot({
        coupleId: auth.couple.id,
        schemaVersion,
        updatedByMemberId: auth.member.id,
        content,
        now
      });
      this.store.insertAuditLog({
        memberId: auth.member.id,
        coupleId: auth.couple.id,
        action: "couple_space.snapshot_saved",
        metadata: {
          revision: storedSnapshot.revision
        },
        now
      });
      return storedSnapshot;
    });

    return jsonResponse(this.config, {
      snapshot
    });
  }

  private async handleMediaUpload(request: Request, context: RequestContext): Promise<Response> {
    this.applyRateLimit("media-upload", context.remoteAddress, { limit: 20, windowMs: 10 * 60 * 1000 });

    const auth = this.requireAuth(request);

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      throw new HttpError(400, "INVALID_MULTIPART", "Body multipart/form-data khong hop le");
    }

    const kind = formData.get("kind");
    const fileEntry = formData.get("file");

    if ((kind !== "image" && kind !== "audio") || !(fileEntry instanceof File)) {
      throw new HttpError(400, "VALIDATION_ERROR", "kind hoac file khong hop le");
    }

    const allowedTypes = kind === "image" ? SUPPORTED_IMAGE_MIME_TYPES : SUPPORTED_AUDIO_MIME_TYPES;
    const maxBytes = kind === "image" ? this.config.maxImageUploadBytes : this.config.maxAudioUploadBytes;

    if (!allowedTypes.includes(fileEntry.type as (typeof allowedTypes)[number])) {
      throw new HttpError(415, "MEDIA_UNSUPPORTED_TYPE", "Mime type khong duoc ho tro");
    }

    if (fileEntry.size > maxBytes) {
      throw new HttpError(413, "MEDIA_TOO_LARGE", "File vuot qua gioi han cho phep");
    }

    const extension = extensionFromMime(fileEntry.type);
    const storageKey = `couple/${auth.couple.id}/${kind}/${randomId("blob")}.${extension}`;
    const absolutePath = resolve(this.config.uploadRoot, storageKey);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, Buffer.from(await fileEntry.arrayBuffer()));

    const now = nowIso();
    const publicUrl = `${this.config.publicBaseUrl.replace(/\/$/, "")}/uploads/${storageKey}`;

    const asset = this.store.transaction(() => {
      const created = this.store.insertMediaAsset({
        coupleId: auth.couple.id,
        uploadedByMemberId: auth.member.id,
        kind,
        storageKey,
        publicUrl,
        contentType: fileEntry.type,
        filename: fileEntry.name || `${kind}.${extension}`,
        sizeBytes: fileEntry.size,
        now
      });
      this.store.insertAuditLog({
        memberId: auth.member.id,
        coupleId: auth.couple.id,
        action: "media.uploaded",
        metadata: {
          assetId: created.id,
          kind
        },
        now
      });
      return created;
    });

    return jsonResponse(this.config, {
      asset: {
        id: asset.id,
        url: asset.publicUrl,
        kind: asset.kind,
        contentType: asset.contentType,
        filename: asset.filename
      }
    });
  }

  private handleReadUpload(relativePath: string): Response {
    const absolutePath = sanitizeUploadPath(this.config.uploadRoot, decodeURIComponent(relativePath));

    try {
      const content = readFileSync(absolutePath);
      return new Response(content, {
        status: 200,
        headers: responseHeaders(this.config, {
          "Content-Type": mimeFromPath(absolutePath),
          "Cache-Control": "private, max-age=60"
        })
      });
    } catch {
      throw new HttpError(404, "MEDIA_NOT_FOUND", "Khong tim thay file");
    }
  }

  seedDefaultAppContent(updatedBy = "seed-script"): Response {
    const now = nowIso();
    const content = validateAppContentCatalog(DEFAULT_APP_CONTENT);
    const record = this.store.upsertActiveAppContent({
      content,
      updatedBy,
      now
    });

    return jsonResponse(this.config, {
      appContent: record
    });
  }
}

let serverlessAppPromise: Promise<LoveApiServer> | undefined;

function readHeader(headers: ServerlessHeaders, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }

  if (typeof (headers as Headers).get === "function") {
    return (headers as Headers).get(name) ?? undefined;
  }

  const record = headers as Record<string, string | string[] | undefined>;
  const value = record[name.toLowerCase()] ?? record[name];

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function isWebRequest(request: Request | IncomingMessage): request is Request {
  return typeof (request as Request).headers?.get === "function";
}

function getRemoteAddress(request: Request | IncomingMessage): string {
  const forwardedFor = readHeader(request.headers, "x-forwarded-for");
  if (forwardedFor) {
    const [firstAddress] = forwardedFor.split(",");
    if (firstAddress) {
      return firstAddress.trim();
    }
  }

  return readHeader(request.headers, "x-real-ip") ?? ("socket" in request ? request.socket.remoteAddress ?? "unknown" : "unknown");
}

function getServerlessRequestOrigin(request: ServerlessRequestLike, publicBaseUrl: string): string {
  const forwardedHost = readHeader(request.headers, "x-forwarded-host");
  const host = forwardedHost?.trim() || readHeader(request.headers, "host")?.trim();

  if (host) {
    const forwardedProto = readHeader(request.headers, "x-forwarded-proto");
    const protocol = forwardedProto?.split(",")[0]?.trim() || "https";
    return `${protocol}://${host}`;
  }

  return publicBaseUrl;
}

export function resolveServerlessUrl(request: ServerlessRequestLike, publicBaseUrl: string): URL {
  const requestUrl = request.url ?? "/";

  try {
    return new URL(requestUrl);
  } catch {
    return new URL(requestUrl, getServerlessRequestOrigin(request, publicBaseUrl));
  }
}

function toServerlessWebRequest(request: IncomingMessage, publicBaseUrl: string): Request {
  const method = request.method ?? "GET";
  const url = resolveServerlessUrl(request, publicBaseUrl);
  const hasBody = !["GET", "HEAD"].includes(method);

  return new Request(url, {
    method,
    headers: request.headers as HeadersInit,
    body: hasBody ? (Readable.toWeb(request) as ReadableStream<Uint8Array>) : undefined,
    duplex: hasBody ? "half" : undefined
  });
}

async function writeServerlessNodeResponse(nodeResponse: ServerResponse, response: Response) {
  nodeResponse.statusCode = response.status;
  response.headers.forEach((value, key) => {
    nodeResponse.setHeader(key, value);
  });

  if (!response.body) {
    nodeResponse.end();
    return;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  nodeResponse.end(buffer);
}

function createInternalErrorResponse(): Response {
  return new Response(
    JSON.stringify({
      error: "Loi he thong",
      code: "INTERNAL_SERVER_ERROR"
    }),
    {
      status: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}

async function getServerlessApp(): Promise<LoveApiServer> {
  if (!serverlessAppPromise) {
    serverlessAppPromise = Promise.resolve().then(() => {
      const app = new LoveApiServer(loadConfig());

      // Ephemeral Vercel instances start from an empty SQLite file, so seed once on boot.
      if (app.config.runtimeTarget === "vercel" && !app.store.getActiveAppContent()) {
        app.seedDefaultAppContent("vercel-bootstrap");
      }

      return app;
    });
  }

  try {
    return await serverlessAppPromise;
  } catch (error) {
    serverlessAppPromise = undefined;
    throw error;
  }
}

function normalizeServerlessRequest(request: Request, publicBaseUrl: string): Request {
  const currentUrl = resolveServerlessUrl(request, publicBaseUrl);
  const pathname = currentUrl.searchParams.get("pathname");

  if (pathname) {
    currentUrl.pathname = pathname;
    currentUrl.searchParams.delete("pathname");
  }

  return new Request(currentUrl, request);
}

export default async function handleServerlessRequest(
  request: Request | IncomingMessage,
  nodeResponse?: ServerResponse
): Promise<Response | void> {
  try {
    const app = await getServerlessApp();
    if (isWebRequest(request)) {
      return await app.handle(normalizeServerlessRequest(request, app.config.publicBaseUrl), {
        remoteAddress: getRemoteAddress(request)
      });
    }

    const response = await app.handle(
      normalizeServerlessRequest(toServerlessWebRequest(request, app.config.publicBaseUrl), app.config.publicBaseUrl),
      {
        remoteAddress: getRemoteAddress(request)
      }
    );

    if (nodeResponse) {
      await writeServerlessNodeResponse(nodeResponse, response);
      return;
    }

    return response;
  } catch (error) {
    console.error("vercel_function_failed", error);

    const response = createInternalErrorResponse();
    if (nodeResponse) {
      await writeServerlessNodeResponse(nodeResponse, response);
      return;
    }

    return response;
  }
}
