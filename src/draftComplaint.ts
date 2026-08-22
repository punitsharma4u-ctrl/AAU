import { AuthorityId, IssueThread, RawReport } from "./types";

const CATEGORY_LABEL: Record<string, string> = {
  garbage: "uncollected garbage / sanitation issue",
  pothole: "road damage / pothole",
  streetlight: "non-functional streetlight",
  water_supply: "water supply disruption",
  sewage: "sewage / drainage issue",
  illegal_boring: "illegal water boring",
  power_outage: "power outage",
  power_fault: "electrical fault",
  road_state_highway: "damage to state/arterial road",
  parks_encroachment: "park encroachment / unauthorized construction",
  stray_animals: "stray animal concern",
  other: "civic issue",
};

// Template-based draft. Swap the body construction for an LLM call (Claude API)
// if you want the phrasing adapted per-report instead of templated — the
// structure (fields an authority needs) should stay fixed either way.
export function draftComplaint(thread: IssueThread, reports: RawReport[], authority: AuthorityId): string {
  const primary = reports[0];
  const label = CATEGORY_LABEL[thread.category] ?? thread.category;
  const reporterLine =
    thread.reporterCount > 1
      ? `This issue has been independently reported by ${thread.reporterCount} residents between ${formatDate(thread.firstReportedAt)} and ${formatDate(thread.lastReportedAt)}.`
      : `Reported on ${formatDate(thread.firstReportedAt)}.`;

  const description = primary.transcript?.trim()
    ? primary.transcript.trim()
    : `Visual indicators detected: ${primary.visualTags.join(", ")}.`;

  return [
    `Subject: Civic complaint — ${label} (Ward: ${thread.wardId})`,
    ``,
    `Authority: ${authority}`,
    `Location: ${thread.centroid.lat.toFixed(6)}, ${thread.centroid.lng.toFixed(6)} (Ward ${thread.wardId})`,
    ``,
    `Description:`,
    description,
    ``,
    reporterLine,
    `Supporting photo/video evidence is attached (${reports.length} submission${reports.length > 1 ? "s" : ""}).`,
    ``,
    `Submitted via Apni Awaaz Uthao / Ghar Ghar Reporter citizen reporting platform.`,
    `Reference thread ID: ${thread.id}`,
  ].join("\n");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
