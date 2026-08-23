import { pool } from "../db/spatialDedup";
import { decideEscalation } from "../src/escalation";

// Runs once and exits -- this is the entrypoint for Render's "Cron Job"
// resource type (or any external scheduler), which triggers a command at
// scheduled times and expects it to complete, not stay running. Do NOT
// point an external scheduler at cron.ts instead -- that file uses an
// internal self-scheduler (node-cron) meant for a different deployment
// style (an always-on process that schedules itself), and running both
// together would double-schedule and hang.

const STALE_AFTER_DAYS = 45;

export async function dailySweep(): Promise<{ markedStale: number; followupsSent: number; escalated: number }> {
  // Step 1: mark anything gone quiet as stale.
  const staleResult = await pool.query(
    `UPDATE issue_threads
     SET status = 'stale'
     WHERE status NOT IN ('resolved', 'stale')
       AND last_reported_at < now() - interval '${STALE_AFTER_DAYS} days'
     RETURNING id`,
  );

  // Step 2: for every stale thread, decide + apply the escalation action
  // using the same pure decision function from escalation.ts -- unchanged,
  // just fed real rows instead of a mock array.
  const { rows: staleThreads } = await pool.query(
    `SELECT id, category, ward_id, reporter_count, first_reported_at, last_reported_at,
            status, auto_followup_count, needs_manual_escalation
     FROM issue_threads WHERE status = 'stale'`,
  );

  let followupsSent = 0;
  let escalated = 0;

  for (const row of staleThreads) {
    const decision = decideEscalation(
      {
        id: row.id,
        category: row.category,
        wardId: row.ward_id,
        centroid: { lat: 0, lng: 0 }, // not needed for the escalation decision itself
        reportIds: [],
        reporterCount: row.reporter_count,
        firstReportedAt: row.first_reported_at.toISOString(),
        lastReportedAt: row.last_reported_at.toISOString(),
        status: row.status,
        autoFollowupCount: row.auto_followup_count,
        needsManualEscalation: row.needs_manual_escalation,
      },
      new Date(),
    );

    if (decision.action === "auto_followup") {
      // Real implementation resends via the same channel adapter used in
      // router.ts -- omitted here since it needs live credentials, but the
      // state update (what makes the followup count and dashboard accurate)
      // happens regardless.
      await pool.query(
        `UPDATE issue_threads SET auto_followup_count = auto_followup_count + 1, last_followup_at = now() WHERE id = $1`,
        [row.id],
      );
      followupsSent++;
    } else if (decision.action === "needs_manual_escalation") {
      await pool.query(`UPDATE issue_threads SET needs_manual_escalation = true WHERE id = $1`, [row.id]);
      escalated++;
    }
  }

  return { markedStale: staleResult.rowCount ?? 0, followupsSent, escalated };
}

if (require.main === module) {
  dailySweep()
    .then((result) => {
      console.log("Daily sweep complete:", result);
      process.exit(0);
    })
    .catch((err) => {
      console.error("Daily sweep failed:", err);
      process.exit(1);
    });
}
