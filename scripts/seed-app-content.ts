import { LoveApiServer } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";

const config = loadConfig();
const app = new LoveApiServer(config);

try {
  const response = app.seedDefaultAppContent();
  console.log(await response.text());
} finally {
  await app.close();
}
