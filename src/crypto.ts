import { argon2Sync, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { AppConfig } from "./config.ts";
import { HttpError } from "./errors.ts";

const ARGON_MEMORY = 65_536;
const ARGON_PASSES = 3;
const ARGON_PARALLELISM = 1;
const ARGON_TAG_LENGTH = 32;
const ARGON_SALT_LENGTH = 16;

interface BaseJwtClaims {
  sub: string;
  coupleId: string;
  email: string;
  type: "access" | "refresh";
  iat: number;
  exp: number;
}

export interface AccessTokenClaims extends BaseJwtClaims {
  type: "access";
}

export interface RefreshTokenClaims extends BaseJwtClaims {
  type: "refresh";
  jti: string;
}

function base64UrlEncode(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomBytes(10).toString("hex")}`;
}

export function generateTemporaryPassword(length = 12): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  let password = "";

  for (const byte of bytes) {
    password += alphabet[byte % alphabet.length];
  }

  return password;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(ARGON_SALT_LENGTH);
  const hash = argon2Sync("argon2id", {
    message: Buffer.from(password),
    nonce: salt,
    parallelism: ARGON_PARALLELISM,
    tagLength: ARGON_TAG_LENGTH,
    memory: ARGON_MEMORY,
    passes: ARGON_PASSES
  });

  return [
    "argon2id",
    `m=${ARGON_MEMORY},t=${ARGON_PASSES},p=${ARGON_PARALLELISM}`,
    salt.toString("base64url"),
    hash.toString("base64url")
  ].join("$");
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split("$");
  if (parts.length !== 4 || parts[0] !== "argon2id") {
    return false;
  }

  const params = parts[1].split(",").reduce<Record<string, number>>((accumulator, entry) => {
    const [key, value] = entry.split("=");
    accumulator[key] = Number(value);
    return accumulator;
  }, {});

  const salt = Buffer.from(parts[2], "base64url");
  const expectedHash = Buffer.from(parts[3], "base64url");
  const actualHash = argon2Sync("argon2id", {
    message: Buffer.from(password),
    nonce: salt,
    parallelism: params.p,
    tagLength: expectedHash.length,
    memory: params.m,
    passes: params.t
  });

  return expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);
}

function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = {
    alg: "HS256",
    typ: "JWT"
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest();

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

export function verifyJwt<T extends Record<string, unknown>>(token: string, secret: string): T {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new HttpError(401, "AUTH_INVALID_TOKEN", "Token khong hop le");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = createHmac("sha256", secret).update(signingInput).digest();
  const receivedSignature = base64UrlDecode(encodedSignature);

  if (
    expectedSignature.length !== receivedSignature.length ||
    !timingSafeEqual(expectedSignature, receivedSignature)
  ) {
    throw new HttpError(401, "AUTH_INVALID_TOKEN", "Token khong hop le");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload).toString("utf8")) as T & {
    exp?: number;
    type?: string;
  };

  if (typeof payload.exp !== "number") {
    throw new HttpError(401, "AUTH_INVALID_TOKEN", "Token khong hop le");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    throw new HttpError(401, "AUTH_TOKEN_EXPIRED", "Token da het han");
  }

  return payload;
}

export function issueAccessToken(
  config: AppConfig,
  claims: Omit<AccessTokenClaims, "iat" | "exp" | "type">
): { token: string; claims: AccessTokenClaims } {
  const now = Math.floor(Date.now() / 1000);
  const payload: AccessTokenClaims = {
    ...claims,
    type: "access",
    iat: now,
    exp: now + config.jwtAccessTtlSeconds
  };

  return {
    token: signJwt(payload, config.jwtAccessSecret),
    claims: payload
  };
}

export function issueRefreshToken(
  config: AppConfig,
  claims: Omit<RefreshTokenClaims, "iat" | "exp" | "type" | "jti">
): { token: string; claims: RefreshTokenClaims } {
  const now = Math.floor(Date.now() / 1000);
  const payload: RefreshTokenClaims = {
    ...claims,
    jti: randomId("rtj"),
    type: "refresh",
    iat: now,
    exp: now + config.jwtRefreshTtlSeconds
  };

  return {
    token: signJwt(payload, config.jwtRefreshSecret),
    claims: payload
  };
}
