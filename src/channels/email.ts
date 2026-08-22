import { Complaint } from "../types";
import { ChannelAdapter, SendResult } from "./types";

// Transactional email adapter (SES, SendGrid, etc). This is the fallback
// channel for authorities with no API and no WhatsApp intake — slower to
// resolve than the other channels but durable, since it hits an official
// grievance address rather than scraping a portal.
export class EmailAdapter implements ChannelAdapter {
  constructor(private readonly fromAddress: string) {}

  async send(complaint: Complaint, toAddress: string): Promise<SendResult> {
    try {
      // Replace with your actual email provider call (SES SendEmail, SendGrid, etc).
      await sendViaProvider({
        from: this.fromAddress,
        to: toAddress,
        subject: complaint.draftText.split("\n")[0].replace("Subject: ", ""),
        body: complaint.draftText,
        attachments: complaint.attachedMediaUrls,
      });
      return { success: true };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}

async function sendViaProvider(_msg: {
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments: string[];
}): Promise<void> {
  // Stub — wire up your provider's SDK here.
  return;
}
