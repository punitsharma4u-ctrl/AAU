import { consolidateReport } from "./dedup";
import { routeAndSubmit } from "./router";
import { IssueThread, RawReport } from "./types";

// Illustrative pipeline: three citizens report the same pothole over a few
// days. The first creates a new thread and triggers a real complaint. The
// second and third merge into it as evidence — no duplicate complaints sent.
async function example() {
  const openThreads: IssueThread[] = [];

  const reports: RawReport[] = [
    {
      id: "rep_001",
      userId: "user_42",
      submittedAt: "2026-08-10T09:00:00.000Z",
      videoUrl: "https://cdn.example.com/videos/rep_001.mp4",
      photoUrls: ["https://cdn.example.com/photos/rep_001_1.jpg"],
      location: { lat: 28.7041, lng: 77.1025 },
      wardId: "MCD_ROHINI_12",
      category: "pothole",
      transcript: "Large pothole on the main road near the market.",
      visualTags: ["road_damage", "pothole"],
      confidence: 0.91,
    },
    {
      id: "rep_002",
      userId: "user_87",
      submittedAt: "2026-08-11T14:30:00.000Z",
      videoUrl: "https://cdn.example.com/videos/rep_002.mp4",
      photoUrls: [],
      location: { lat: 28.70415, lng: 77.10255 }, // ~6m from rep_001, same pothole
      wardId: "MCD_ROHINI_12",
      category: "pothole",
      transcript: "Same pothole, getting worse after the rain.",
      visualTags: ["road_damage", "pothole", "water_pooling"],
      confidence: 0.88,
    },
    {
      id: "rep_003",
      userId: "user_15",
      submittedAt: "2026-08-13T07:15:00.000Z",
      videoUrl: "https://cdn.example.com/videos/rep_003.mp4",
      photoUrls: ["https://cdn.example.com/photos/rep_003_1.jpg"],
      location: { lat: 28.7042, lng: 77.1026 }, // still within cluster radius
      wardId: "MCD_ROHINI_12",
      category: "pothole",
      transcript: "This pothole almost caused an accident this morning.",
      visualTags: ["road_damage", "pothole"],
      confidence: 0.95,
    },
  ];

  const reportsById = new Map(reports.map((r) => [r.id, r]));

  for (const report of reports) {
    const { thread, isNewThread, needsManualReview } = consolidateReport(report, openThreads);

    if (needsManualReview) {
      console.log(`${report.id}: low confidence (${report.confidence}), holding for manual review`);
      continue;
    }

    const idx = openThreads.findIndex((t) => t.id === thread.id);
    if (idx >= 0) openThreads[idx] = thread;
    else openThreads.push(thread);

    if (isNewThread) {
      const threadReports = thread.reportIds.map((id) => reportsById.get(id)!);
      const complaint = await routeAndSubmit(thread, threadReports);
      console.log(`${report.id}: new thread ${thread.id} -> complaint ${complaint.status} (${complaint.channel})`);
    } else {
      console.log(`${report.id}: merged into existing thread ${thread.id} (now ${thread.reporterCount} reporters)`);
    }
  }
}

example();
