import {
  type AppContentCatalog,
  ARTWORK_OPTION_IDS,
  GALLERY_STAGE_VALUES,
  HOME_FEATURE_ROUTES,
  SECRET_REACTION_IDS
} from "./domain.ts";
import { HttpError } from "./errors.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", message);
  }

  return value;
}

function expectString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, "VALIDATION_ERROR", `${fieldName} la bat buoc`);
  }

  return value.trim();
}

function expectArray(value: unknown, fieldName: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "VALIDATION_ERROR", `${fieldName} phai la mang`);
  }

  return value;
}

function isAllowed<T extends readonly string[]>(value: string, allowed: T): value is T[number] {
  return allowed.includes(value as T[number]);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateRegisterPayload(payload: unknown): {
  primaryEmail: string;
  secondaryEmail: string;
  label: string;
} {
  const body = expectRecord(payload, "Payload khong hop le");
  const primaryEmail = expectString(body.primaryEmail, "primaryEmail");
  const secondaryEmail = expectString(body.secondaryEmail, "secondaryEmail");
  const label = typeof body.label === "string" && body.label.trim() !== "" ? body.label.trim() : "Nha cua hai dua";

  if (!isValidEmail(primaryEmail) || !isValidEmail(secondaryEmail)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Email khong dung dinh dang");
  }

  if (normalizeEmail(primaryEmail) === normalizeEmail(secondaryEmail)) {
    throw new HttpError(400, "AUTH_DUPLICATE_EMAILS", "Hai email phai khac nhau");
  }

  return { primaryEmail, secondaryEmail, label };
}

export function validateLoginPayload(payload: unknown): { email: string; password: string } {
  const body = expectRecord(payload, "Payload khong hop le");
  const email = expectString(body.email, "email");
  const password = expectString(body.password, "password");

  if (!isValidEmail(email)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Email khong dung dinh dang");
  }

  return { email, password };
}

export function validateRefreshPayload(payload: unknown): { refreshToken: string } {
  const body = expectRecord(payload, "Payload khong hop le");
  const refreshToken = expectString(body.refreshToken, "refreshToken");
  return { refreshToken };
}

export function validateResetRequestPayload(payload: unknown): { email: string } {
  const body = expectRecord(payload, "Payload khong hop le");
  const email = expectString(body.email, "email");

  if (!isValidEmail(email)) {
    throw new HttpError(400, "VALIDATION_ERROR", "Email khong dung dinh dang");
  }

  return { email };
}

export function validatePasswordChangePayload(
  payload: unknown,
  minimumLength: number
): { newPassword: string } {
  const body = expectRecord(payload, "Payload khong hop le");
  const newPassword = expectString(body.newPassword, "newPassword");

  if (newPassword.length < minimumLength) {
    throw new HttpError(
      422,
      "AUTH_WEAK_PASSWORD",
      `Mat khau moi phai co it nhat ${minimumLength} ky tu`
    );
  }

  return { newPassword };
}

export function validateSnapshotPayload(payload: unknown): {
  schemaVersion: number;
  content: Record<string, unknown>;
} {
  const body = expectRecord(payload, "Payload khong hop le");
  const snapshot = expectRecord(body.snapshot, "snapshot la bat buoc");
  const schemaVersion = snapshot.schemaVersion;
  const content = expectRecord(snapshot.content, "snapshot.content phai la object");

  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion) || schemaVersion <= 0) {
    throw new HttpError(400, "VALIDATION_ERROR", "snapshot.schemaVersion khong hop le");
  }

  return { schemaVersion, content };
}

export function validateAppContentCatalog(payload: unknown): AppContentCatalog {
  const body = expectRecord(payload, "app content khong hop le");

  const people = expectArray(body.people, "people").map((entry) => expectString(entry, "people[]"));
  const homeFeatures = expectArray(body.homeFeatures, "homeFeatures").map((entry) => {
    const item = expectRecord(entry, "homeFeatures[] khong hop le");
    const route = expectString(item.route, "homeFeatures.route");
    if (!isAllowed(route, HOME_FEATURE_ROUTES)) {
      throw new HttpError(400, "APP_CONTENT_INVALID_ROUTE", `homeFeatures.route khong ho tro: ${route}`);
    }

    return {
      label: expectString(item.label, "homeFeatures.label"),
      subtitle: expectString(item.subtitle, "homeFeatures.subtitle"),
      route,
      icon: expectString(item.icon, "homeFeatures.icon")
    };
  });

  const artworkOptions = expectArray(body.artworkOptions, "artworkOptions").map((entry) => {
    const value = expectString(entry, "artworkOptions[]");
    if (!isAllowed(value, ARTWORK_OPTION_IDS)) {
      throw new HttpError(400, "APP_CONTENT_INVALID_ARTWORK", `artworkOptions khong ho tro: ${value}`);
    }
    return value;
  });

  const moodOptions = expectArray(body.moodOptions, "moodOptions").map((entry) => {
    const item = expectRecord(entry, "moodOptions[] khong hop le");
    const score = item.score;
    if (typeof score !== "number" || !Number.isFinite(score)) {
      throw new HttpError(400, "APP_CONTENT_INVALID_MOOD", "moodOptions.score phai la number");
    }

    return {
      id: expectString(item.id, "moodOptions.id"),
      label: expectString(item.label, "moodOptions.label"),
      icon: expectString(item.icon, "moodOptions.icon"),
      score
    };
  });

  const secretReactions = expectArray(body.secretReactions, "secretReactions").map((entry) => {
    const item = expectRecord(entry, "secretReactions[] khong hop le");
    const id = expectString(item.id, "secretReactions.id");
    if (!isAllowed(id, SECRET_REACTION_IDS)) {
      throw new HttpError(400, "APP_CONTENT_INVALID_REACTION", `secretReactions.id khong ho tro: ${id}`);
    }

    return {
      id,
      label: expectString(item.label, "secretReactions.label"),
      icon: expectString(item.icon, "secretReactions.icon")
    };
  });

  const galleryStageOptions = expectArray(body.galleryStageOptions, "galleryStageOptions").map((entry) => {
    const item = expectRecord(entry, "galleryStageOptions[] khong hop le");
    const value = expectString(item.value, "galleryStageOptions.value");
    if (!isAllowed(value, GALLERY_STAGE_VALUES)) {
      throw new HttpError(
        400,
        "APP_CONTENT_INVALID_STAGE",
        `galleryStageOptions.value khong ho tro: ${value}`
      );
    }

    return {
      label: expectString(item.label, "galleryStageOptions.label"),
      value
    };
  });

  const capsuleOptions = expectArray(body.capsuleOptions, "capsuleOptions").map((entry) =>
    expectString(entry, "capsuleOptions[]")
  );
  const dailyPrompts = expectArray(body.dailyPrompts, "dailyPrompts").map((entry) =>
    expectString(entry, "dailyPrompts[]")
  );

  return {
    people,
    homeFeatures,
    artworkOptions,
    moodOptions,
    secretReactions,
    galleryStageOptions,
    capsuleOptions,
    dailyPrompts
  };
}
