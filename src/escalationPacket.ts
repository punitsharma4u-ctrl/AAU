import { Complaint, IssueThread, RawReport } from "./types";

// When a thread crosses into needsManualEscalation, this generates the
// concrete materials a human uses to act — not another automated send.
// Two outputs: a phone call script (fastest path with a utility/MCD call
// centre) and a draft public post (for the accountability-journalism angle
// of Ghar Ghar Reporter) that a human reviews and chooses to publish or not.

export interface EscalationPacket {
  threadId: string;
  callScript: string;
  draftPublicPost: string;
  daysSinceFirstReport: number;
  daysSinceLastFollowup: number | null;
}

const HELPLINES: Record<string, string> = {
  MCD: "MCD-311 helpline (see app) or ward office",
  NDMC: "NDMC helpline 1533",
  DJB: "DJB toll-free 1916 / 1800117118",
  BRPL: "BSES Rajdhani 19123",
  BYPL: "BSES Yamuna 19123",
  TATA_POWER_DDL: "Tata Power-DDL 19124",
  PWD: "PWD Delhi helpline (see delhi.gov.in)",
  DDA: "DDA grievance cell (see dda.gov.in)",
  DELHI_POLICE: "N/A — not applicable to this category",
};

function daysBetween(a: string, b: Date): number {
  return Math.floor((b.getTime() - new Date(a).getTime()) / (1000 * 60 * 60 * 24));
}

export function buildEscalationPacket(
  thread: IssueThread,
  complaint: Complaint,
  reports: RawReport[],
  now: Date = new Date(),
): EscalationPacket {
  const helpline = HELPLINES[complaint.authority] ?? "authority's published contact channel";
  const daysSinceFirstReport = daysBetween(thread.firstReportedAt, now);
  const daysSinceLastFollowup = thread.lastFollowupAt ? daysBetween(thread.lastFollowupAt, now) : null;

  const callScript = [
    `Calling: ${helpline}`,
    `Reference number(s) on file: ${complaint.authorityReferenceId ?? "none issued yet"}`,
    ``,
    `Script:`,
    `"I'm calling to follow up on a complaint filed ${daysSinceFirstReport} days ago regarding ${thread.category} in ${thread.wardId}.`,
    `It has been reported by ${thread.reporterCount} resident${thread.reporterCount > 1 ? "s" : ""} and has received ${thread.autoFollowupCount} written follow-up${thread.autoFollowupCount !== 1 ? "s" : ""} with no resolution.`,
    `Could you please provide a status update and an expected resolution date?"`,
    ``,
    `If no reference number was ever issued, ask them to confirm whether the original complaint (${complaint.channel}) was received at all — it may not have registered.`,
  ].join("\n");

  const draftPublicPost = [
    `${thread.reporterCount} resident${thread.reporterCount > 1 ? "s" : ""} of ${thread.wardId} have reported the same unresolved issue: ${thread.category}.`,
    `First reported ${daysSinceFirstReport} days ago to ${complaint.authority}. No resolution despite ${thread.autoFollowupCount} follow-up${thread.autoFollowupCount !== 1 ? "s" : ""}.`,
    ``,
    `[Draft only — review before publishing. Verify facts, consider whether to name the authority`,
    `directly or reference the department generally, and confirm none of the attached media`,
    `identifies individuals who haven't consented to being shown publicly.]`,
  ].join("\n");

  return { threadId: thread.id, callScript, draftPublicPost, daysSinceFirstReport, daysSinceLastFollowup };
}
