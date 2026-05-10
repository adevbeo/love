import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

export type RuntimeTarget = "local" | "vercel";

export interface AppConfig {
  port: number;
  nodeEnv: string;
  runtimeTarget: RuntimeTarget;
  dbPath: string;
  publicBaseUrl: string;
  corsOrigin: string;
  jwtAccessSecret: string;
  jwtRefreshSecret: string;
  jwtAccessExpiresIn: string;
  jwtRefreshExpiresIn: string;
  jwtAccessTtlSeconds: number;
  jwtRefreshTtlSeconds: number;
  maxImageUploadBytes: number;
  maxAudioUploadBytes: number;
  passwordMinLength: number;
  uploadRoot: string;
  mailFrom: string;
  mailProvider: string;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric env value: ${value}`);
  }

  return parsed;
}

function parseDurationSeconds(value: string, envName: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value);
  if (!match) {
    throw new Error(`Invalid duration for ${envName}: ${value}`);
  }

  const amount = Number(match[1]);
  const unit = match[2];

  switch (unit) {
    case "s":
      return amount;
    case "m":
      return amount * 60;
    case "h":
      return amount * 60 * 60;
    case "d":
      return amount * 24 * 60 * 60;
    default:
      throw new Error(`Unsupported duration unit for ${envName}: ${unit}`);
  }
}

function ensureParentDirectory(pathname: string) {
  mkdirSync(dirname(pathname), { recursive: true });
}

function detectRuntimeTarget(): RuntimeTarget {
  return process.env.VERCEL === "1" ? "vercel" : "local";
}

function defaultDbPath(runtimeTarget: RuntimeTarget): string {
  if (runtimeTarget === "vercel") {
    return resolve(tmpdir(), "love-api", "love-api.sqlite");
  }

  return resolve(process.cwd(), "data/love-api.sqlite");
}

function defaultUploadRoot(runtimeTarget: RuntimeTarget): string {
  if (runtimeTarget === "vercel") {
    return resolve(tmpdir(), "love-api", "uploads");
  }

  return resolve(process.cwd(), "storage/uploads");
}

function defaultPublicBaseUrl(port: number): string {
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return `http://localhost:${port}`;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const port = overrides.port ?? parseNumber(process.env.PORT, 3000);
  const nodeEnv = overrides.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const runtimeTarget = overrides.runtimeTarget ?? detectRuntimeTarget();
  const dbPath = overrides.dbPath ?? resolve(process.cwd(), process.env.DB_PATH ?? defaultDbPath(runtimeTarget));
  const uploadRoot = overrides.uploadRoot ?? resolve(process.cwd(), process.env.UPLOAD_ROOT ?? defaultUploadRoot(runtimeTarget));

  ensureParentDirectory(dbPath);
  mkdirSync(uploadRoot, { recursive: true });

  const jwtAccessExpiresIn = overrides.jwtAccessExpiresIn ?? process.env.JWT_ACCESS_EXPIRES_IN ?? "15m";
  const jwtRefreshExpiresIn = overrides.jwtRefreshExpiresIn ?? process.env.JWT_REFRESH_EXPIRES_IN ?? "30d";

  const config: AppConfig = {
    port,
    nodeEnv,
    runtimeTarget,
    dbPath,
    uploadRoot,
    publicBaseUrl: overrides.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? defaultPublicBaseUrl(port),
    corsOrigin: overrides.corsOrigin ?? process.env.CORS_ORIGIN ?? "*",
    jwtAccessSecret: overrides.jwtAccessSecret ?? process.env.JWT_ACCESS_SECRET ?? "dev-access-secret-change-me",
    jwtRefreshSecret: overrides.jwtRefreshSecret ?? process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret-change-me",
    jwtAccessExpiresIn,
    jwtRefreshExpiresIn,
    jwtAccessTtlSeconds:
      overrides.jwtAccessTtlSeconds ?? parseDurationSeconds(jwtAccessExpiresIn, "JWT_ACCESS_EXPIRES_IN"),
    jwtRefreshTtlSeconds:
      overrides.jwtRefreshTtlSeconds ?? parseDurationSeconds(jwtRefreshExpiresIn, "JWT_REFRESH_EXPIRES_IN"),
    maxImageUploadBytes: overrides.maxImageUploadBytes ?? parseNumber(process.env.MAX_IMAGE_UPLOAD_BYTES, 10 * 1024 * 1024),
    maxAudioUploadBytes: overrides.maxAudioUploadBytes ?? parseNumber(process.env.MAX_AUDIO_UPLOAD_BYTES, 20 * 1024 * 1024),
    passwordMinLength: overrides.passwordMinLength ?? parseNumber(process.env.PASSWORD_MIN_LENGTH, 10),
    mailFrom: overrides.mailFrom ?? process.env.MAIL_FROM ?? "no-reply@example.com",
    mailProvider: overrides.mailProvider ?? process.env.MAIL_PROVIDER ?? "queued"
  };

  return config;
}
