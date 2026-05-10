import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import type {
  AppContentCatalog,
  AppContentRecord,
  CoupleAccount,
  CoupleMember,
  EmailJobRecord,
  MediaAssetRecord,
  RefreshTokenRecord,
  SnapshotRecord
} from "./domain.ts";
import type { AppConfig } from "./config.ts";
import { randomId } from "./crypto.ts";

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function toCoupleAccount(row: Record<string, unknown>): CoupleAccount {
  return {
    id: String(row.id),
    primaryEmail: String(row.primary_email),
    secondaryEmail: String(row.secondary_email),
    label: String(row.label),
    status: String(row.status),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function toCoupleMember(row: Record<string, unknown>): CoupleMember {
  return {
    id: String(row.id),
    coupleId: String(row.couple_id),
    email: String(row.email),
    emailNormalized: String(row.email_normalized),
    displayName: row.display_name === null ? null : String(row.display_name),
    passwordHash: String(row.password_hash),
    requiresPasswordChange: Number(row.requires_password_change) === 1,
    status: String(row.status),
    passwordIssuedAt: String(row.password_issued_at),
    passwordChangedAt: row.password_changed_at === null ? null : String(row.password_changed_at),
    lastLoginAt: row.last_login_at === null ? null : String(row.last_login_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function toRefreshTokenRecord(row: Record<string, unknown>): RefreshTokenRecord {
  return {
    id: String(row.id),
    memberId: String(row.member_id),
    coupleId: String(row.couple_id),
    jwtId: String(row.jwt_id),
    tokenHash: String(row.token_hash),
    expiresAt: String(row.expires_at),
    revokedAt: row.revoked_at === null ? null : String(row.revoked_at),
    createdAt: String(row.created_at)
  };
}

function toSnapshotRecord(row: Record<string, unknown>): SnapshotRecord {
  return {
    id: String(row.id),
    coupleId: String(row.couple_id),
    schemaVersion: Number(row.schema_version),
    revision: Number(row.revision),
    updatedAt: String(row.updated_at),
    updatedByMemberId: row.updated_by_member_id === null ? null : String(row.updated_by_member_id),
    content: parseJson<Record<string, unknown>>(String(row.content_json))
  };
}

function toAppContentRecord(row: Record<string, unknown>): AppContentRecord {
  return {
    id: String(row.id),
    version: Number(row.version),
    status: String(row.status),
    content: parseJson<AppContentCatalog>(String(row.content_json)),
    updatedAt: String(row.updated_at),
    updatedBy: String(row.updated_by)
  };
}

function toMediaAssetRecord(row: Record<string, unknown>): MediaAssetRecord {
  return {
    id: String(row.id),
    coupleId: String(row.couple_id),
    uploadedByMemberId: String(row.uploaded_by_member_id),
    kind: String(row.kind) as "image" | "audio",
    storageKey: String(row.storage_key),
    publicUrl: String(row.public_url),
    contentType: String(row.content_type),
    filename: String(row.filename),
    sizeBytes: Number(row.size_bytes),
    createdAt: String(row.created_at)
  };
}

function toEmailJobRecord(row: Record<string, unknown>): EmailJobRecord {
  return {
    id: String(row.id),
    memberId: row.member_id === null ? null : String(row.member_id),
    coupleId: row.couple_id === null ? null : String(row.couple_id),
    recipientEmail: String(row.recipient_email),
    template: String(row.template),
    payload: parseJson<Record<string, unknown>>(String(row.payload_json)),
    status: String(row.status) as EmailJobRecord["status"],
    attempts: Number(row.attempts),
    lastError: row.last_error === null ? null : String(row.last_error),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export class AppStore {
  readonly db: DatabaseSync;

  constructor(config: AppConfig) {
    this.db = new DatabaseSync(config.dbPath);
    this.db.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
  }

  close() {
    this.db.close();
  }

  transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  insertCoupleAccount(params: {
    primaryEmail: string;
    secondaryEmail: string;
    label: string;
    now: string;
  }): CoupleAccount {
    const id = randomId("couple");
    this.db
      .prepare(
        `
          INSERT INTO couple_accounts (
            id,
            primary_email,
            secondary_email,
            label,
            status,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, 'active', ?, ?)
        `
      )
      .run(id, params.primaryEmail, params.secondaryEmail, params.label, params.now, params.now);

    return {
      id,
      primaryEmail: params.primaryEmail,
      secondaryEmail: params.secondaryEmail,
      label: params.label,
      status: "active",
      createdAt: params.now,
      updatedAt: params.now
    };
  }

  insertCoupleMember(params: {
    coupleId: string;
    email: string;
    emailNormalized: string;
    passwordHash: string;
    now: string;
  }): CoupleMember {
    const id = randomId("member");
    this.db
      .prepare(
        `
          INSERT INTO couple_members (
            id,
            couple_id,
            email,
            email_normalized,
            display_name,
            password_hash,
            requires_password_change,
            status,
            password_issued_at,
            password_changed_at,
            last_login_at,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, NULL, ?, 1, 'active', ?, NULL, NULL, ?, ?)
        `
      )
      .run(id, params.coupleId, params.email, params.emailNormalized, params.passwordHash, params.now, params.now, params.now);

    return {
      id,
      coupleId: params.coupleId,
      email: params.email,
      emailNormalized: params.emailNormalized,
      displayName: null,
      passwordHash: params.passwordHash,
      requiresPasswordChange: true,
      status: "active",
      passwordIssuedAt: params.now,
      passwordChangedAt: null,
      lastLoginAt: null,
      createdAt: params.now,
      updatedAt: params.now
    };
  }

  findCoupleById(coupleId: string): CoupleAccount | null {
    const row = this.db.prepare("SELECT * FROM couple_accounts WHERE id = ? LIMIT 1").get(coupleId) as
      | Record<string, unknown>
      | undefined;
    return row ? toCoupleAccount(row) : null;
  }

  findMemberById(memberId: string): CoupleMember | null {
    const row = this.db.prepare("SELECT * FROM couple_members WHERE id = ? LIMIT 1").get(memberId) as
      | Record<string, unknown>
      | undefined;
    return row ? toCoupleMember(row) : null;
  }

  findMemberByEmailNormalized(emailNormalized: string): CoupleMember | null {
    const row = this.db
      .prepare("SELECT * FROM couple_members WHERE email_normalized = ? LIMIT 1")
      .get(emailNormalized) as Record<string, unknown> | undefined;
    return row ? toCoupleMember(row) : null;
  }

  touchMemberLogin(memberId: string, now: string) {
    this.db
      .prepare("UPDATE couple_members SET last_login_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, memberId);
  }

  updateMemberPasswordForReset(memberId: string, passwordHash: string, now: string) {
    this.db
      .prepare(
        `
          UPDATE couple_members
          SET password_hash = ?,
              requires_password_change = 1,
              password_issued_at = ?,
              password_changed_at = NULL,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(passwordHash, now, now, memberId);
  }

  completePasswordChange(memberId: string, passwordHash: string, now: string) {
    this.db
      .prepare(
        `
          UPDATE couple_members
          SET password_hash = ?,
              requires_password_change = 0,
              password_changed_at = ?,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(passwordHash, now, now, memberId);
  }

  insertRefreshToken(params: {
    memberId: string;
    coupleId: string;
    jwtId: string;
    tokenHash: string;
    expiresAt: string;
    now: string;
  }): RefreshTokenRecord {
    const id = randomId("rt");
    this.db
      .prepare(
        `
          INSERT INTO refresh_tokens (
            id,
            member_id,
            couple_id,
            jwt_id,
            token_hash,
            expires_at,
            revoked_at,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)
        `
      )
      .run(id, params.memberId, params.coupleId, params.jwtId, params.tokenHash, params.expiresAt, params.now);

    return {
      id,
      memberId: params.memberId,
      coupleId: params.coupleId,
      jwtId: params.jwtId,
      tokenHash: params.tokenHash,
      expiresAt: params.expiresAt,
      revokedAt: null,
      createdAt: params.now
    };
  }

  findRefreshTokenByHash(tokenHash: string): RefreshTokenRecord | null {
    const row = this.db.prepare("SELECT * FROM refresh_tokens WHERE token_hash = ? LIMIT 1").get(tokenHash) as
      | Record<string, unknown>
      | undefined;
    return row ? toRefreshTokenRecord(row) : null;
  }

  revokeRefreshToken(tokenHash: string, revokedAt: string) {
    this.db
      .prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .run(revokedAt, tokenHash);
  }

  revokeAllRefreshTokensForMember(memberId: string, revokedAt: string) {
    this.db
      .prepare("UPDATE refresh_tokens SET revoked_at = ? WHERE member_id = ? AND revoked_at IS NULL")
      .run(revokedAt, memberId);
  }

  insertEmailJob(params: {
    memberId: string | null;
    coupleId: string | null;
    recipientEmail: string;
    template: string;
    payload: Record<string, unknown>;
    now: string;
  }): EmailJobRecord {
    const id = randomId("email");
    this.db
      .prepare(
        `
          INSERT INTO email_jobs (
            id,
            member_id,
            couple_id,
            recipient_email,
            template,
            payload_json,
            status,
            attempts,
            last_error,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, NULL, ?, ?)
        `
      )
      .run(
        id,
        params.memberId,
        params.coupleId,
        params.recipientEmail,
        params.template,
        JSON.stringify(params.payload),
        params.now,
        params.now
      );

    return {
      id,
      memberId: params.memberId,
      coupleId: params.coupleId,
      recipientEmail: params.recipientEmail,
      template: params.template,
      payload: params.payload,
      status: "queued",
      attempts: 0,
      lastError: null,
      createdAt: params.now,
      updatedAt: params.now
    };
  }

  getLatestEmailJobForRecipient(recipientEmail: string): EmailJobRecord | null {
    const row = this.db
      .prepare("SELECT * FROM email_jobs WHERE recipient_email = ? ORDER BY created_at DESC LIMIT 1")
      .get(recipientEmail) as Record<string, unknown> | undefined;
    return row ? toEmailJobRecord(row) : null;
  }

  listQueuedEmailJobs(limit = 50): EmailJobRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM email_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT ?")
      .all(limit) as Record<string, unknown>[];
    return rows.map((row) => toEmailJobRecord(row));
  }

  markEmailJobSent(emailJobId: string, now: string) {
    this.db
      .prepare("UPDATE email_jobs SET status = 'sent', attempts = attempts + 1, updated_at = ? WHERE id = ?")
      .run(now, emailJobId);
  }

  markEmailJobFailed(emailJobId: string, errorMessage: string, now: string) {
    this.db
      .prepare(
        `
          UPDATE email_jobs
          SET status = 'failed',
              attempts = attempts + 1,
              last_error = ?,
              updated_at = ?
          WHERE id = ?
        `
      )
      .run(errorMessage, now, emailJobId);
  }

  insertAuditLog(params: {
    memberId: string | null;
    coupleId: string | null;
    action: string;
    metadata: Record<string, unknown>;
    now: string;
  }) {
    this.db
      .prepare(
        `
          INSERT INTO audit_logs (
            id,
            member_id,
            couple_id,
            action,
            metadata_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(randomId("audit"), params.memberId, params.coupleId, params.action, JSON.stringify(params.metadata), params.now);
  }

  getActiveAppContent(): AppContentRecord | null {
    const row = this.db.prepare("SELECT * FROM app_content WHERE id = 'active' LIMIT 1").get() as
      | Record<string, unknown>
      | undefined;
    return row ? toAppContentRecord(row) : null;
  }

  upsertActiveAppContent(params: {
    content: AppContentCatalog;
    updatedBy: string;
    now: string;
    version?: number;
  }): AppContentRecord {
    const current = this.getActiveAppContent();
    const nextVersion = params.version ?? (current ? current.version + 1 : 1);

    this.db
      .prepare(
        `
          INSERT INTO app_content (
            id,
            version,
            status,
            content_json,
            updated_at,
            updated_by
          ) VALUES ('active', ?, 'active', ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            version = excluded.version,
            status = excluded.status,
            content_json = excluded.content_json,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
        `
      )
      .run(nextVersion, JSON.stringify(params.content), params.now, params.updatedBy);

    return {
      id: "active",
      version: nextVersion,
      status: "active",
      content: params.content,
      updatedAt: params.now,
      updatedBy: params.updatedBy
    };
  }

  getSnapshotByCoupleId(coupleId: string): SnapshotRecord | null {
    const row = this.db.prepare("SELECT * FROM couple_snapshots WHERE couple_id = ? LIMIT 1").get(coupleId) as
      | Record<string, unknown>
      | undefined;
    return row ? toSnapshotRecord(row) : null;
  }

  putSnapshot(params: {
    coupleId: string;
    schemaVersion: number;
    updatedByMemberId: string;
    content: Record<string, unknown>;
    now: string;
  }): SnapshotRecord {
    const current = this.getSnapshotByCoupleId(params.coupleId);
    const revision = current ? current.revision + 1 : 1;
    const id = current?.id ?? params.coupleId;

    this.db
      .prepare(
        `
          INSERT INTO couple_snapshots (
            id,
            couple_id,
            schema_version,
            revision,
            updated_at,
            updated_by_member_id,
            content_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(couple_id) DO UPDATE SET
            schema_version = excluded.schema_version,
            revision = excluded.revision,
            updated_at = excluded.updated_at,
            updated_by_member_id = excluded.updated_by_member_id,
            content_json = excluded.content_json
        `
      )
      .run(
        id,
        params.coupleId,
        params.schemaVersion,
        revision,
        params.now,
        params.updatedByMemberId,
        JSON.stringify(params.content)
      );

    return {
      id,
      coupleId: params.coupleId,
      schemaVersion: params.schemaVersion,
      revision,
      updatedAt: params.now,
      updatedByMemberId: params.updatedByMemberId,
      content: params.content
    };
  }

  insertMediaAsset(params: {
    coupleId: string;
    uploadedByMemberId: string;
    kind: "image" | "audio";
    storageKey: string;
    publicUrl: string;
    contentType: string;
    filename: string;
    sizeBytes: number;
    now: string;
  }): MediaAssetRecord {
    const id = randomId("asset");
    this.db
      .prepare(
        `
          INSERT INTO media_assets (
            id,
            couple_id,
            uploaded_by_member_id,
            kind,
            storage_key,
            public_url,
            content_type,
            filename,
            size_bytes,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        params.coupleId,
        params.uploadedByMemberId,
        params.kind,
        params.storageKey,
        params.publicUrl,
        params.contentType,
        params.filename,
        params.sizeBytes,
        params.now
      );

    return {
      id,
      coupleId: params.coupleId,
      uploadedByMemberId: params.uploadedByMemberId,
      kind: params.kind,
      storageKey: params.storageKey,
      publicUrl: params.publicUrl,
      contentType: params.contentType,
      filename: params.filename,
      sizeBytes: params.sizeBytes,
      createdAt: params.now
    };
  }
}
