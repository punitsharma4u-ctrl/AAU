import { Complaint } from "../types";
import { ChannelAdapter, SendResult } from "./types";

// For authorities with neither an API nor WhatsApp intake (PWD, NDMC, DDA).
// Deliberately does NOT scrape or auto-fill their web forms via headless
// browser — that breaks on redesigns and risks violating terms of service.
// Instead: draft is ready, citizen gets a one-tap confirm in-app, which
// either fires the email adapter or opens the authority's own form pre-filled
// via query params where the portal supports it.
export class AssistedPortalAdapter implements ChannelAdapter {
  async send(complaint: Complaint, contact: string): Promise<SendResult> {
    // No network call here — this marks the complaint as ready for citizen
    // action. The app surfaces it in the "needs your confirm" queue.
    return { success: true, requiresManualStep: true };
  }
}
