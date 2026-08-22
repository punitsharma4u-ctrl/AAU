import { Complaint } from "../types";
import { ChannelAdapter, SendResult } from "./types";

// Sends via a WhatsApp Business Solution Provider (Twilio, Gupshup, etc).
// DJB and BSES both accept complaints on official WhatsApp numbers, so this
// is a legitimate structured channel, not a workaround.
//
// NOTE: BSES specifically requires the consumer's 9-digit account number in
// a fixed format ("#NC,<CA number>") rather than free text. DJB accepts a
// freer description. Keep authority-specific formatting here, not upstream.
export class WhatsAppAdapter implements ChannelAdapter {
  constructor(
    private readonly apiKey: string,
    private readonly senderNumber: string,
  ) {}

  async send(complaint: Complaint, targetNumber: string): Promise<SendResult> {
    const message = this.formatMessage(complaint);

    try {
      // Replace with your BSP's actual send-message endpoint.
      const res = await fetch("https://api.your-whatsapp-bsp.com/v1/messages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.senderNumber,
          to: targetNumber,
          type: "text",
          text: { body: message },
        }),
      });

      if (!res.ok) {
        return { success: false, error: `WhatsApp send failed: ${res.status}` };
      }

      // Most utilities reply asynchronously with a complaint/reference number —
      // that reply needs a separate inbound webhook handler to capture and
      // attach to this complaint. This call only confirms the message sent.
      return { success: true, requiresManualStep: false };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  private formatMessage(complaint: Complaint): string {
    if (complaint.authority === "BRPL" || complaint.authority === "BYPL") {
      // BSES requires this exact format to register in their CRM.
      const caNumber = extractAccountNumber(complaint.draftText);
      return caNumber ? `#NC,${caNumber}` : complaint.draftText;
    }
    // DJB accepts descriptive text.
    return complaint.draftText;
  }
}

function extractAccountNumber(text: string): string | null {
  const match = text.match(/Account:\s*(\d{9})/);
  return match ? match[1] : null;
}
