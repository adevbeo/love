import { LoveApiServer } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

let appPromise: Promise<LoveApiServer> | undefined;

function getRemoteAddress(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const [firstAddress] = forwardedFor.split(",");
    if (firstAddress) {
      return firstAddress.trim();
    }
  }

  return request.headers.get("x-real-ip") ?? "unknown";
}

async function getApp(): Promise<LoveApiServer> {
  if (!appPromise) {
    appPromise = Promise.resolve().then(() => {
      const app = new LoveApiServer(loadConfig());

      // Ephemeral Vercel instances start from an empty SQLite file, so seed once on boot.
      if (app.config.runtimeTarget === "vercel" && !app.store.getActiveAppContent()) {
        app.seedDefaultAppContent("vercel-bootstrap");
      }

      return app;
    });
  }

  try {
    return await appPromise;
  } catch (error) {
    appPromise = undefined;
    throw error;
  }
}

function rewriteRequest(request: Request): Request {
  const currentUrl = new URL(request.url);
  const pathname = currentUrl.searchParams.get("pathname");

  if (!pathname) {
    throw new Error("Missing rewritten pathname");
  }

  currentUrl.pathname = pathname;
  currentUrl.searchParams.delete("pathname");

  return new Request(currentUrl, request);
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      const app = await getApp();
      return await app.handle(rewriteRequest(request), {
        remoteAddress: getRemoteAddress(request)
      });
    } catch (error) {
      console.error("vercel_function_failed", error);

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
  }
};
