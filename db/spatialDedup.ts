import { Pool } from "pg";

const CLUSTER_RADIUS_METERS = 100;

export const pool = new Pool({
  host: process.env.PGHOST ?? "localhost",
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? "app",
  password: process.env.PGPASSWORD ?? "app",
  database: process.env.PGDATABASE ?? "complaint_router",
});

export interface DbThread {
  id: string;
  category: string;
  ward_id: string;
  centroid_lat: number;
  centroid_lng: number;
  reporter_count: number;
  first_reported_at: string;
  last_reported_at: string;
  status: string;
  auto_followup_count: number;
  needs_manual_escalation: boolean;
}

// This is the real version of findMatchingThread() from dedup.ts. Instead of
// looping over every open thread in application memory, it asks Postgres to
// use the GIST index on issue_threads.centroid to find candidates directly —
// O(log n) via the index instead of O(n) in JS, and it stays fast as thread
// count grows into the tens of thousands.
export async function findMatchingThreadInDb(
  category: string,
  lat: number,
  lng: number,
  radiusMeters: number = CLUSTER_RADIUS_METERS,
): Promise<DbThread | null> {
  const { rows } = await pool.query(
    `SELECT
       id, category, ward_id,
       ST_Y(centroid::geometry) AS centroid_lat,
       ST_X(centroid::geometry) AS centroid_lng,
       reporter_count, first_reported_at, last_reported_at, status,
       auto_followup_count, needs_manual_escalation
     FROM issue_threads
     WHERE category = $1
       AND status NOT IN ('resolved', 'stale')
       AND ST_DWithin(centroid, ST_MakePoint($2, $3)::geography, $4)
     ORDER BY ST_Distance(centroid, ST_MakePoint($2, $3)::geography) ASC
     LIMIT 1`,
    [category, lng, lat, radiusMeters],
  );
  return rows[0] ?? null;
}

// Merges a new report's location into an existing thread's centroid as a
// running average, weighted by how many reports already contributed to it.
export async function mergeIntoThread(threadId: string, reportId: string, lat: number, lng: number): Promise<void> {
  await pool.query("BEGIN");
  try {
    const { rows } = await pool.query(
      `SELECT reporter_count, ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng
       FROM issue_threads WHERE id = $1 FOR UPDATE`,
      [threadId],
    );
    const t = rows[0];
    const n = t.reporter_count + 1;
    const newLat = (t.lat * t.reporter_count + lat) / n;
    const newLng = (t.lng * t.reporter_count + lng) / n;

    await pool.query(
      `UPDATE issue_threads
       SET reporter_count = $1,
           centroid = ST_MakePoint($2, $3)::geography,
           last_reported_at = now()
       WHERE id = $4`,
      [n, newLng, newLat, threadId],
    );
    await pool.query(`UPDATE raw_reports SET issue_thread_id = $1 WHERE id = $2`, [threadId, reportId]);
    await pool.query("COMMIT");
  } catch (err) {
    await pool.query("ROLLBACK");
    throw err;
  }
}

export async function createThread(
  threadId: string,
  category: string,
  wardId: string,
  lat: number,
  lng: number,
  reportId: string,
): Promise<void> {
  await pool.query("BEGIN");
  try {
    await pool.query(
      `INSERT INTO issue_threads (id, category, ward_id, centroid, reporter_count, first_reported_at, last_reported_at, status)
       VALUES ($1, $2, $3, ST_MakePoint($4,$5)::geography, 1, now(), now(), 'new')`,
      [threadId, category, wardId, lng, lat],
    );
    await pool.query(`UPDATE raw_reports SET issue_thread_id = $1 WHERE id = $2`, [threadId, reportId]);
    await pool.query("COMMIT");
  } catch (err) {
    await pool.query("ROLLBACK");
    throw err;
  }
}
