import { LoveApiServer } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
const app = new LoveApiServer(config);

await app.listen(config.port);

console.log(`love.api listening on ${config.publicBaseUrl}`);

async function shutdown(signal: string) {
  console.log(`received ${signal}, shutting down`);
  await app.close();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
