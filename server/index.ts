import express from "express";
import path from "path";
import { pool } from "../db/spatialDedup";
import { resolveWard } from "../db/wardLookup";
import { findMatchingThreadInDb, mergeIntoThread, createThread } from "../db/spatialDedup";
import { resolveAuthority } from "../src/authorityMap";
import { draftComplaint } from "../src/draftComplaint";
import { IssueThread, RawReport } from "../src/types";

const app = express();
app.use(express.json());
// Serves upload.html and dashboard.html directly -- one deployed service
// instead of separately hosting the API and the static pages.
app.use(express.static(path.join(__dirname, "../../public")));

const MIN_CONFIDENCE_FOR_AUTO_ROUTE = 0.6;

// POST /reports/init-upload
// Returns a presigned S3 PUT URL. The actual AWS call is commented out
// (no real bucket/credentials in this environment) but the presign
// generation itself is pure crypto -- no network call -- so this shows the
// real shape of the endpoint.
app.post("/reports/init-upload", async (req, res) => {
  const { fileName, contentType } = req.body;
  if (!fileName || !contentType) {
    return res.status(400).json({ error: "fileName and contentType required" });
  }

  const reportId = "rep_" + Math.random().toString(36).slice(2, 10);
  const key = `raw-uploads/${reportId}/${fileName}`;

  // Real implementation:
  //   const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
  //   const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
  //   const client = new S3Client({ region: process.env.AWS_REGION });
  //   const command = new PutObjectCommand({ Bucket: process.env.UPLOAD_BUCKET, Key: key, ContentType: contentType });
  //   const uploadUrl = await getSignedUrl(client, command, { expiresIn: 300 });
  const uploadUrl = `https://YOUR_BUCKET.s3.amazonaws.com/${key}?X-Amz-Signature=DEMO`;

  res.json({ reportId, uploadUrl, key });
});

// POST /reports
// Called after the client finishes uploading to S3. This is the real,
// database-backed version of the flow that example.ts simulated in memory:
// resolve ward -> consolidate (spatial query, not a JS loop) -> draft if new.
//
// Note: no face/plate blurring step in this pipeline -- out of scope for
// this project by decision, not omission. server/blurFaces.py exists as a
// tested, working script if that changes later, but it's not wired in here.
app.post("/reports", async (req, res) => {
  const { reportId, userId, location, category, transcript, confidence, videoUrl, photoUrls } = req.body;

  if (!reportId || !location || !category || confidence === undefined) {
    return res.status(400).json({ error: "reportId, location, category, confidence required" });
  }

  const ward = await resolveWard(location.lat, location.lng);
  if (!ward) {
    // Point falls outside all known ward boundaries -- flag for manual
    // review rather than silently dropping it or guessing.
    return res.status(202).json({ status: "needs_manual_review", reason: "location outside known ward boundaries" });
  }

  await pool.query(
    `INSERT INTO raw_reports (id, user_id, video_url, photo_urls, location, ward_id, category, transcript, confidence)
     VALUES ($1, $2, $3, $4, ST_MakePoint($5,$6)::geography, $7, $8, $9, $10)`,
    [reportId, userId ?? "anonymous", videoUrl, photoUrls ?? [], location.lng, location.lat, ward.wardId, category, transcript, confidence],
  );

  if (confidence < MIN_CONFIDENCE_FOR_AUTO_ROUTE) {
    return res.status(202).json({ status: "needs_manual_review", reason: "low classification confidence" });
  }

  const match = await findMatchingThreadInDb(category, location.lat, location.lng);

  if (match) {
    await mergeIntoThread(match.id, reportId, location.lat, location.lng);
    return res.json({ status: "merged", threadId: match.id, reporterCount: match.reporter_count + 1 });
  }

  const threadId = "thr_" + reportId;
  await createThread(threadId, category, ward.wardId, location.lat, location.lng, reportId);

  // Build the draft using the same pure function from draftComplaint.ts --
  // reused unchanged, just fed real DB-backed data instead of in-memory mocks.
  const thread: IssueThread = {
    id: threadId,
    category,
    wardId: ward.wardId,
    centroid: location,
    reportIds: [reportId],
    reporterCount: 1,
    firstReportedAt: new Date().toISOString(),
    lastReportedAt: new Date().toISOString(),
    status: "new",
    autoFollowupCount: 0,
    needsManualEscalation: false,
  };
  const report: RawReport = {
    id: reportId,
    userId: userId ?? "anonymous",
    submittedAt: new Date().toISOString(),
    videoUrl,
    photoUrls: photoUrls ?? [],
    location,
    wardId: ward.wardId,
    category,
    transcript: transcript ?? "",
    visualTags: [],
    confidence,
  };

  const route = resolveAuthority(category, ward.wardId);
  const draftText = draftComplaint(thread, [report], route.authority);
  const complaintId = "cmp_" + threadId;

  await pool.query(
    `INSERT INTO complaints (id, issue_thread_id, authority, channel, channel_contact, draft_text, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'drafted')`,
    [complaintId, threadId, route.authority, route.channel, route.contact, draftText],
  );
  await pool.query(`UPDATE issue_threads SET complaint_id = $1 WHERE id = $2`, [complaintId, threadId]);

  res.json({ status: "new_thread", threadId, complaintId, authority: route.authority, channel: route.channel });
});

app.get("/health", (_req, res) => res.json({ ok: true }));

// GET /threads
// Real replacement for dashboard.html's hardcoded THREADS mock array.
app.get("/threads", async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT
      t.id, t.category, t.ward_id, t.reporter_count, t.status,
      t.auto_followup_count, t.needs_manual_escalation, t.last_reported_at,
      c.id AS complaint_id, c.authority, c.channel, c.draft_text,
      c.authority_reference_id, c.status AS complaint_status
    FROM issue_threads t
    LEFT JOIN complaints c ON c.issue_thread_id = t.id
    ORDER BY t.last_reported_at DESC
  `);
  res.json(rows);
});

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`Ingestion API listening on :${PORT}`));

export default app;
