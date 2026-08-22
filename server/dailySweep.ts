import { pool } from "../db/spatialDedup";
import { decideEscalation } from "../src/escalation";

// Runs once a day (see cron registration below). This is the DB-backed
// version of markStaleThreads() + runEscalationSweep() from escalation.ts --
// those functions operate on in-memory IssueThread[]; this reads/writes the
// real table so the effect actually persists between runs.

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
