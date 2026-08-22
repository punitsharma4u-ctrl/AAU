import { Complaint } from "../types";
import { ChannelAdapter, SendResult } from "./types";

// Open311 GeoReport v2 adapter for MCD-311. This is the one channel with a
// genuine public API, per MCD-311's own listing (adopts Open311 protocols).
// You'll need MCD's actual endpoint + api_key once you register as a developer.
export class Open311Adapter implements ChannelAdapter {
  async send(complaint: Complaint, apiBaseUrl: string): Promise<SendResult> {
    try {
      const res = await fetch(`${apiBaseUrl}/requests.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Open311 GeoReport v2 fields — map complaint fields into these.
          service_code: mapCategoryToServiceCode(complaint),
          description: complaint.draftText,
          media_url: complaint.attachedMediaUrls[0],
          // lat/long should be pulled from the parent issue thread by the caller
        }),
      });

      if (!res.ok) {
        return { success: false, error: `Open311 request failed: ${res.status}` };
      }

      const data = (await res.json()) as { service_request_id?: string };
      return { success: true, authorityReferenceId: data.service_request_id };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
}

function mapCategoryToServiceCode(complaint: Complaint): string {
  // Placeholder — real service codes come from MCD's /services.json discovery endpoint.
  return "civic-issue";
}
