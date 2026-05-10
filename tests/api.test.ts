import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { LoveApiServer } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

interface TestContext {
  app: LoveApiServer;
  cleanup: () => Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) {
      await cleanup();
    }
  }
});

async function createTestContext(): Promise<TestContext> {
  const root = mkdtempSync(join(tmpdir(), "love-api-"));
  const app = new LoveApiServer(
    loadConfig({
      dbPath: join(root, "love-api.sqlite"),
      uploadRoot: join(root, "uploads"),
      publicBaseUrl: "http://test.local"
    })
  );
  app.seedDefaultAppContent("test-seed");

  const cleanup = async () => {
    await app.close();
    rmSync(root, { recursive: true, force: true });
  };

  cleanups.push(cleanup);

  return {
    app,
    cleanup
  };
}

async function readJson(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

async function registerCouple(app: LoveApiServer) {
  const response = await app.inject({
    method: "POST",
    path: "/api/auth/register-couple",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      primaryEmail: "anh@example.com",
      secondaryEmail: "em@example.com",
      label: "Nha cua hai dua"
    })
  });

  assert.equal(response.status, 201);
}

function getTempPassword(app: LoveApiServer, recipient: string): string {
  const emailJob = app.store.getLatestEmailJobForRecipient(recipient);
  assert.ok(emailJob);
  assert.equal(typeof emailJob.payload.tempPassword, "string");
  return emailJob.payload.tempPassword as string;
}

async function login(app: LoveApiServer, email: string, password: string) {
  const response = await app.inject({
    method: "POST",
    path: "/api/auth/login",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email,
      password
    })
  });

  assert.equal(response.status, 200);
  return (await readJson(response)).session as Record<string, unknown>;
}

async function completePasswordChange(app: LoveApiServer, accessToken: string, newPassword: string) {
  const response = await app.inject({
    method: "POST",
    path: "/api/auth/complete-password-change",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      newPassword
    })
  });

  assert.equal(response.status, 200);
  return (await readJson(response)).session as Record<string, unknown>;
}

test("GET /api/app-content returns seeded catalog", async () => {
  const { app } = await createTestContext();

  const response = await app.inject({
    method: "GET",
    path: "/api/app-content"
  });

  assert.equal(response.status, 200);

  const body = await readJson(response);
  const appContent = body.appContent as Record<string, unknown>;
  const content = appContent.content as Record<string, unknown>;

  assert.equal(appContent.status, "active");
  assert.ok(Array.isArray(content.people));
  assert.ok(Array.isArray(content.homeFeatures));
  assert.ok((content.homeFeatures as unknown[]).length > 0);
});

test("register rejects duplicate emails after normalization", async () => {
  const { app } = await createTestContext();

  const response = await app.inject({
    method: "POST",
    path: "/api/auth/register-couple",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      primaryEmail: "Anh@Example.com",
      secondaryEmail: " anh@example.com "
    })
  });

  assert.equal(response.status, 400);

  const body = await readJson(response);
  assert.equal(body.code, "AUTH_DUPLICATE_EMAILS");
});

test("temp login requires password change and refresh works after completion", async () => {
  const { app } = await createTestContext();
  await registerCouple(app);

  const tempPassword = getTempPassword(app, "anh@example.com");
  const firstSession = await login(app, "anh@example.com", tempPassword);

  assert.equal(firstSession.requiresPasswordChange, true);

  const blockedCoupleSpace = await app.inject({
    method: "GET",
    path: "/api/couple-space",
    headers: {
      authorization: `Bearer ${String(firstSession.accessToken)}`
    }
  });

  assert.equal(blockedCoupleSpace.status, 403);
  assert.equal((await readJson(blockedCoupleSpace)).code, "AUTH_PASSWORD_CHANGE_REQUIRED");

  const changedSession = await completePasswordChange(app, String(firstSession.accessToken), "NewStrongPass123");
  assert.equal(changedSession.requiresPasswordChange, false);

  const refreshResponse = await app.inject({
    method: "POST",
    path: "/api/auth/refresh",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      refreshToken: changedSession.refreshToken
    })
  });

  assert.equal(refreshResponse.status, 200);
  assert.equal(((await readJson(refreshResponse)).session as Record<string, unknown>).requiresPasswordChange, false);
});

test("snapshot persists and both members of the couple see the same data", async () => {
  const { app } = await createTestContext();
  await registerCouple(app);

  const tempPassword = getTempPassword(app, "anh@example.com");
  const firstMember = await completePasswordChange(
    app,
    String((await login(app, "anh@example.com", tempPassword)).accessToken),
    "StrongPass12345"
  );

  const emptySnapshotResponse = await app.inject({
    method: "GET",
    path: "/api/couple-space",
    headers: {
      authorization: `Bearer ${String(firstMember.accessToken)}`
    }
  });

  assert.equal(emptySnapshotResponse.status, 200);
  assert.equal((await readJson(emptySnapshotResponse)).snapshot, null);

  const saveResponse = await app.inject({
    method: "PUT",
    path: "/api/couple-space",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${String(firstMember.accessToken)}`
    },
    body: JSON.stringify({
      snapshot: {
        schemaVersion: 1,
        content: {
          diaries: [
            {
              id: "diary-1",
              text: "Hom nay anh nho em."
            }
          ]
        }
      }
    })
  });

  assert.equal(saveResponse.status, 200);
  assert.equal((((await readJson(saveResponse)).snapshot as Record<string, unknown>).revision), 1);

  const secondMember = await completePasswordChange(
    app,
    String((await login(app, "em@example.com", tempPassword)).accessToken),
    "AnotherStrongPass123"
  );

  const secondReadResponse = await app.inject({
    method: "GET",
    path: "/api/couple-space",
    headers: {
      authorization: `Bearer ${String(secondMember.accessToken)}`
    }
  });

  assert.equal(secondReadResponse.status, 200);
  const snapshot = (await readJson(secondReadResponse)).snapshot as Record<string, unknown>;
  const content = snapshot.content as Record<string, unknown>;
  const diaries = content.diaries as Array<Record<string, unknown>>;

  assert.equal(diaries[0].text, "Hom nay anh nho em.");
});

test("request reset returns generic response and issues a new temporary password", async () => {
  const { app } = await createTestContext();
  await registerCouple(app);

  const tempPassword = getTempPassword(app, "anh@example.com");
  const changedSession = await completePasswordChange(
    app,
    String((await login(app, "anh@example.com", tempPassword)).accessToken),
    "StablePass12345"
  );

  assert.equal(changedSession.requiresPasswordChange, false);

  const resetResponse = await app.inject({
    method: "POST",
    path: "/api/auth/request-reset",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email: "anh@example.com"
    })
  });

  assert.equal(resetResponse.status, 200);
  assert.equal((await readJson(resetResponse)).message, "Neu email ton tai, mat khau tam da duoc xep hang gui di");

  const resetPassword = getTempPassword(app, "anh@example.com");
  assert.notEqual(resetPassword, tempPassword);

  const resetSession = await login(app, "anh@example.com", resetPassword);
  assert.equal(resetSession.requiresPasswordChange, true);
});

test("media upload accepts valid image and rejects unsupported mime types", async () => {
  const { app } = await createTestContext();
  await registerCouple(app);

  const tempPassword = getTempPassword(app, "anh@example.com");
  const session = await completePasswordChange(
    app,
    String((await login(app, "anh@example.com", tempPassword)).accessToken),
    "UploadPass12345"
  );

  const form = new FormData();
  form.set("kind", "image");
  form.set("file", new File([Buffer.from("fake-png-binary")], "memory.png", { type: "image/png" }));

  const uploadResponse = await app.inject({
    method: "POST",
    path: "/api/media/upload",
    headers: {
      authorization: `Bearer ${String(session.accessToken)}`
    },
    body: form
  });

  assert.equal(uploadResponse.status, 200);
  const uploadBody = await readJson(uploadResponse);
  const asset = uploadBody.asset as Record<string, unknown>;
  assert.equal(asset.kind, "image");

  const uploadedFileResponse = await app.inject({
    method: "GET",
    path: String((asset.url as string).replace("http://test.local", ""))
  });

  assert.equal(uploadedFileResponse.status, 200);
  assert.equal(uploadedFileResponse.headers.get("content-type"), "image/png");

  const badForm = new FormData();
  badForm.set("kind", "image");
  badForm.set("file", new File([Buffer.from("plain-text")], "bad.txt", { type: "text/plain" }));

  const badUploadResponse = await app.inject({
    method: "POST",
    path: "/api/media/upload",
    headers: {
      authorization: `Bearer ${String(session.accessToken)}`
    },
    body: badForm
  });

  assert.equal(badUploadResponse.status, 415);
  assert.equal((await readJson(badUploadResponse)).code, "MEDIA_UNSUPPORTED_TYPE");
});
