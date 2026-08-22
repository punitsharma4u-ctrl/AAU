import { GeoPoint, IssueThread, RawReport } from "./types";

// Reports of the same category within this radius are treated as the same
// real-world issue. 100m is a reasonable starting point for street-level
// civic issues (pothole, streetlight) — tune per category later if needed
// (e.g. water supply disruptions might reasonably cluster at 300m+, since
// one pipeline fault affects a wider area than one pothole).
const DEFAULT_CLUSTER_RADIUS_METERS = 100;

// After this many days with no new reports and no resolution, a thread is
// considered stale rather than actively open — surfaced separately in the
// dashboard rather than kept in the "new reports still merging in" bucket.
const STALE_AFTER_DAYS = 45;

// A report this unsure about its own category shouldn't silently join a
// cluster or trigger an auto-submission. It's held for manual review instead.
const MIN_CONFIDENCE_FOR_AUTO_ROUTE = 0.6;

export interface ConsolidationResult {
  thread: IssueThread;
  isNewThread: boolean;
  needsManualReview: boolean;
}

// Haversine distance in meters between two lat/lng points.
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return R * c;
}

// Finds an existing open thread this report should merge into, if any.
// Only considers threads that aren't already resolved/stale — a new report
// near an already-fixed pothole is a *new* issue, not evidence for the old one.
function findMatchingThread(
  report: RawReport,
  openThreads: IssueThread[],
  radiusMeters: number,
): IssueThread | undefined {
  return openThreads.find((thread) => {
    if (thread.category !== report.category) return false;
    if (thread.status === "resolved" || thread.status === "stale") return false;
    return distanceMeters(thread.centroid, report.location) <= radiusMeters;
  });
}

// Recomputes a thread's centroid as the running average of all its reports'
// locations, weighted equally. Simple and good enough at this scale; swap
// for a proper geometric median if outlier GPS pins become a problem.
function mergeCentroid(existing: GeoPoint, existingCount: number, next: GeoPoint): GeoPoint {
  const n = existingCount + 1;
  return {
    lat: (existing.lat * existingCount + next.lat) / n,
    lng: (existing.lng * existingCount + next.lng) / n,
  };
}

// Main entry point, called once per incoming RawReport (after AI analysis,
// before routing). Returns either an updated existing thread or a brand new
// one, plus whether it needs a human to check the category/location before
// anything gets auto-submitted.
export function consolidateReport(
  report: RawReport,
  openThreads: IssueThread[],
  radiusMeters: number = DEFAULT_CLUSTER_RADIUS_METERS,
): ConsolidationResult {
  const needsManualReview = report.confidence < MIN_CONFIDENCE_FOR_AUTO_ROUTE;

  const match = findMatchingThread(report, openThreads, radiusMeters);

  if (match) {
    const updated: IssueThread = {
      ...match,
      reportIds: [...match.reportIds, report.id],
      reporterCount: match.reporterCount + 1,
      centroid: mergeCentroid(match.centroid, match.reportIds.length, report.location),
      lastReportedAt: report.submittedAt,
      // A previously-drafted/submitted thread that gets a fresh report stays
      // in its current status — new evidence attaches, it doesn't restart
      // the complaint. Only a brand-new thread starts at "new".
    };
    return { thread: updated, isNewThread: false, needsManualReview };
  }

  const newThread: IssueThread = {
    id: `thr_${report.id}`,
    category: report.category,
    wardId: report.wardId,
    centroid: report.location,
    reportIds: [report.id],
    reporterCount: 1,
    firstReportedAt: report.submittedAt,
    lastReportedAt: report.submittedAt,
    status: "new",
    autoFollowupCount: 0,
    needsManualEscalation: false,
  };
  return { thread: newThread, isNewThread: true, needsManualReview };
}

// Run periodically (daily cron) over all open threads to flag ones that have
// gone quiet without being marked resolved by the authority.
export function markStaleThreads(threads: IssueThread[], now: Date = new Date()): IssueThread[] {
  return threads.map((thread) => {
    if (thread.status === "resolved" || thread.status === "stale") return thread;
    const daysSinceUpdate = (now.getTime() - new Date(thread.lastReportedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate > STALE_AFTER_DAYS) {
      return { ...thread, status: "stale" as const };
    }
    return thread;
  });
}
