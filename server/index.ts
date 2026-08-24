import express from "express";
import path from "path";
import multer from "multer";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { pool } from "../db/spatialDedup";
import { resolveWard } from "../db/wardLookup";
import { findMatchingThreadInDb, mergeIntoThread, createThread } from "../db/spatialDedup";
import { resolveAuthority } from "../src/authorityMap";
import { draftComplaint } from "../src/draftComplaint";
import { IssueThread, RawReport } from "../src/types";
import { extractFrame } from "./extractFrame";
import { generateDescriptionFromFrame } from "./generateDescription";

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../../public")));

const MIN_CONFIDENCE_FOR_AUTO_ROUTE = 0.6;

const s3Client = new S3Client({
  region: process.env.AWS_REGION ?? "ap-south-1",
  requestChecksumCalculation: "WHEN_REQUIRED",
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// POST /reports/upload-media
// Server-proxied upload: the browser sends the file here (same-origin,
// multipart/form-data), and the server uploads it to S3 itself using the
// AWS SDK directly -- no presigned URL, no browser-to-S3 connection at all.
// Switched to this after a direct presigned-URL PUT from the browser
// consistently failed with net::ERR_CONNECTION_RESET in live testing, even
// after fixing the known SDK checksum issue -- this sidesteps that whole
// class of browser/network-specific failure.
app.post("/reports/upload-media", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file provided" });
  }

  const bucket = process.env.UPLOAD_BUCKET;
  if (!bucket) {
    return res.status(500).json({ error: "UPLOAD_BUCKET not configured on the server" });
  }

  const reportId = "rep_" + Math.random().toString(36).slice(2, 10);
  const key = `raw-uploads/${reportId}/${req.file.originalname}`;
  const category = req.body.category || "civic issue";

  // AI-generated description from the actual media, since most citizens
  // won't type one -- this runs before the S3 upload so a slow/failed AI
  // call doesn't hold up storing the file, and a failure here degrades
  // gracefully (returns null) rather than blocking the whole submission.
  let aiDescription: string | null = null;
  try {
    const isVideo = req.file.mimetype.startsWith("video/");
    const frameForAnalysis = isVideo ? await extractFrame(req.file.buffer, req.file.originalname) : req.file.buffer;
    aiDescription = await generateDescriptionFromFrame(frameForAnalysis, category);
  } catch (err) {
    console.error("AI description generation failed (non-fatal):", (err as Error).message);
  }

  try {
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      }),
    );
    const publicUrl = `https://${bucket}.s3.${process.env.AWS_REGION ?? "ap-south-1"}.amazonaws.com/${key}`;
    res.json({ reportId, publicUrl, aiDescription });
  } catch (err) {
    res.status(500).json({ error: `Upload to storage failed: ${(err as Error).message}` });
  }
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

// Catches anything unhandled by a route -- including errors thrown inside
// middleware like multer (e.g. file-size limits, malformed multipart data)
// before it ever reaches a route's own try/catch. Without this, Express's
// default handler returns a bare HTML 500 with no detail, which is exactly
// what happened when a real multer-layer failure showed up as an opaque
// "(500)" on the client with nothing to debug from.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: err.message || "Unknown server error" });
});

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`Ingestion API listening on :${PORT}`));

export default app;
