import { loadConfig } from "../src/config.ts";
import { AppStore } from "../src/db.ts";

const config = loadConfig();
const store = new AppStore(config);

const jobs = store.listQueuedEmailJobs();
const now = new Date().toISOString();

try {
  for (const job of jobs) {
    try {
      if (config.mailProvider === "queued" || config.mailProvider === "log") {
        console.log(
          JSON.stringify({
            to: job.recipientEmail,
            template: job.template,
            payload: job.payload
          })
        );
        store.markEmailJobSent(job.id, now);
        continue;
      }

      throw new Error(`MAIL_PROVIDER ${config.mailProvider} chua duoc tich hop`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown email worker error";
      store.markEmailJobFailed(job.id, message, now);
    }
  }
} finally {
  store.close();
}

console.log(`processed ${jobs.length} email job(s)`);
