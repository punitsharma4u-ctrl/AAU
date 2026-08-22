import { Complaint, IssueThread } from "./types";
import { ChannelAdapter } from "./channels/types";

// Wait this long after a thread goes stale before sending the first
// automatic follow-up, then this long between subsequent follow-ups.
const FOLLOWUP_INTERVAL_DAYS = 15;

// After this many automatic follow-ups with no resolution, stop auto-acting
// and hand the thread to a human. Repeatedly nudging an authority that isn't
// responding stops being useful and starts looking like spam — the right
// move at that point is a human decision (call, public post, drop it),
// not another automated message.
const MAX_AUTO_FOLLOWUPS = 2;

export interface EscalationAction {
  threadId: string;
  action: "none" | "auto_followup" | "needs_manual_escalation";
  reason: string;
}

function daysSince(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

// Decides what, if anything, should happen to a stale thread. Pure function
// — no side effects — so it's easy to test and to preview in the dashboard
// before anything actually sends.
export function decideEscalation(thread: IssueThread, now: Date = new Date()): EscalationAction {
  if (thread.status !== "stale") {
    return { threadId: thread.id, action: "none", reason: "thread is not stale" };
  }

  if (thread.needsManualEscalation) {
    return { threadId: thread.id, action: "none", reason: "already flagged for manual escalation" };
  }

  if (thread.autoFollowupCount >= MAX_AUTO_FOLLOWUPS) {
    return {
      threadId: thread.id,
      action: "needs_manual_escalation",
      reason: `${MAX_AUTO_FOLLOWUPS} automatic follow-ups sent with no resolution — needs a human decision`,
    };
  }

  const referencePoint = thread.lastFollowupAt ?? thread.lastReportedAt;
  if (daysSince(referencePoint, now) >= FOLLOWUP_INTERVAL_DAYS) {
    return {
      threadId: thread.id,
      action: "auto_followup",
      reason: `${FOLLOWUP_INTERVAL_DAYS}+ days since last contact, follow-up ${thread.autoFollowupCount + 1} of ${MAX_AUTO_FOLLOWUPS}`,
    };
  }

  return { threadId: thread.id, action: "none", reason: "within follow-up interval, waiting" };
}

// Run this on a daily cron over all stale threads. Only ever sends through
// the SAME channel the original complaint used — a follow-up is a resend,
// not a new complaint through a different, possibly louder, channel.
export async function runEscalationSweep(
  threads: IssueThread[],
  complaint: (threadId: string) => Complaint | undefined,
  adapter: (channel: Complaint["channel"]) => ChannelAdapter,
  now: Date = new Date(),
): Promise<IssueThread[]> {
  const updated: IssueThread[] = [];

  for (const thread of threads) {
    const decision = decideEscalation(thread, now);

    if (decision.action === "auto_followup") {
      const original = complaint(thread.id);
      if (original) {
        const followupText = `Follow-up on unresolved complaint (thread ${thread.id}, ${thread.autoFollowupCount + 1} of ${MAX_AUTO_FOLLOWUPS} automatic reminders):\n\n${original.draftText}`;
        await adapter(original.channel).send({ ...original, draftText: followupText }, original.channelContact);
      }
      updated.push({
        ...thread,
        autoFollowupCount: thread.autoFollowupCount + 1,
        lastFollowupAt: now.toISOString(),
      });
    } else if (decision.action === "needs_manual_escalation") {
      updated.push({ ...thread, needsManualEscalation: true });
    } else {
      updated.push(thread);
    }
  }

  return updated;
}
