import { resolveAuthority } from "./authorityMap";
import { draftComplaint } from "./draftComplaint";
import { Complaint, IssueThread, RawReport, SubmissionChannel } from "./types";
import { ChannelAdapter } from "./channels/types";
import { Open311Adapter } from "./channels/open311";
import { WhatsAppAdapter } from "./channels/whatsapp";
import { EmailAdapter } from "./channels/email";
import { AssistedPortalAdapter } from "./channels/assistedPortal";

// Wire real credentials in from your config/secrets manager.
const adapters: Record<SubmissionChannel, ChannelAdapter> = {
  open311_api: new Open311Adapter(),
  whatsapp_business_api: new WhatsAppAdapter(process.env.WHATSAPP_API_KEY ?? "", process.env.WHATSAPP_SENDER ?? ""),
  email: new EmailAdapter(process.env.COMPLAINTS_FROM_EMAIL ?? "no-reply@apniaawazuthao.in"),
  assisted_portal_link: new AssistedPortalAdapter(),
  // Never wire an adapter that actually sends here — by design.
  citizen_confirm_required: new AssistedPortalAdapter(),
};

// Entry point: called once a RawReport has been consolidated into an
// IssueThread (see dedup logic — separate module) and the thread is new
// (i.e. doesn't already have a complaint filed).
export async function routeAndSubmit(thread: IssueThread, reports: RawReport[]): Promise<Complaint> {
  const route = resolveAuthority(thread.category, thread.wardId);
  const draftText = draftComplaint(thread, reports, route.authority);

  const complaint: Complaint = {
    id: `cmp_${thread.id}`,
    issueThreadId: thread.id,
    authority: route.authority,
    channel: route.channel,
    channelContact: route.contact,
    draftText,
    attachedMediaUrls: reports.flatMap((r) => [r.videoUrl, ...r.photoUrls]),
    status: "drafted",
    createdAt: new Date().toISOString(),
  };

  const adapter = adapters[route.channel];
  const result = await adapter.send(complaint, route.contact);

  if (!result.success) {
    complaint.status = "failed";
    return complaint;
  }

  if (result.requiresManualStep) {
    // Sits in the citizen's "confirm to send" queue until they tap through.
    complaint.status = "awaiting_confirm";
    return complaint;
  }

  complaint.status = "sent";
  complaint.sentAt = new Date().toISOString();
  complaint.authorityReferenceId = result.authorityReferenceId;
  return complaint;
}
