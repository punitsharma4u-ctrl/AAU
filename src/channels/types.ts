import { Complaint } from "../types";

export interface SendResult {
  success: boolean;
  authorityReferenceId?: string; // filled in if the channel returns one immediately (rare)
  error?: string;
  requiresManualStep?: boolean; // true for assisted_portal_link / citizen_confirm_required
}

export interface ChannelAdapter {
  send(complaint: Complaint, contact: string): Promise<SendResult>;
}
