import cron from "node-cron";
import { dailySweep } from "./dailySweep";

// Runs every day at 2 AM IST. In production this process should run as its
// own long-lived service (or a scheduled Lambda / ECS task) -- not inside
// the same process as the request-handling API server, so a crash in one
// doesn't take down the other.
export function startDailySweepCron(): void {
  cron.schedule(
    "0 2 * * *",
    async () => {
      console.log(`[${new Date().toISOString()}] Running daily escalation sweep...`);
      try {
        const result = await dailySweep();
        console.log(`[${new Date().toISOString()}] Sweep complete:`, result);
      } catch (err) {
        console.error(`[${new Date().toISOString()}] Sweep failed:`, err);
      }
    },
    { timezone: "Asia/Kolkata" },
  );
  console.log("Daily escalation cron registered: 2:00 AM IST");
}

if (require.main === module) {
  startDailySweepCron();
}
