// Core domain types for the complaint drafting + authority routing engine.
// This is the schema everything else (dedup, dashboard, channel adapters) plugs into.

export type IssueCategory =
  | "garbage"
  | "pothole"
  | "streetlight"
  | "water_supply"
  | "sewage"
  | "illegal_boring"
  | "power_outage"
  | "power_fault"
  | "road_state_highway" // PWD-maintained roads, not local MCD roads
  | "parks_encroachment"
  | "stray_animals"
  | "other";

export type AuthorityId =
  | "MCD"
  | "NDMC"
  | "DELHI_CANTONMENT"
  | "DJB"
  | "BRPL"
  | "BYPL"
  | "TATA_POWER_DDL"
  | "PWD"
  | "DDA"
  | "DELHI_POLICE";

// How a complaint actually gets to the authority. Determines which channel
// adapter picks it up in router.ts.
export type SubmissionChannel =
  | "open311_api" // true API auto-submit (MCD only, currently)
  | "whatsapp_business_api" // DJB, BSES — structured message to official number
  | "email" // transactional email to official grievance address
  | "assisted_portal_link" // pre-filled deep link, citizen taps submit
  | "citizen_confirm_required"; // never auto-send (e.g. Delhi Police)

export interface GeoPoint {
  lat: number;
  lng: number;
}

// A single raw video submission from a user, post AI-analysis.
export interface RawReport {
  id: string;
  userId: string;
  submittedAt: string; // ISO timestamp
  videoUrl: string;
  photoUrls: string[];
  location: GeoPoint;
  wardId: string; // resolved from a ward-boundary lookup, not from category alone
  category: IssueCategory;
  transcript: string; // speech-to-text output
  visualTags: string[]; // frame-classification labels
  confidence: number; // 0-1, model confidence in category assignment
  linkedAccountNumber?: string; // DJB/BSES consumer account number, if the user has linked one
}

// A consolidated issue thread. Multiple RawReports can point to one IssueThread
// (same category + location cluster). Only the thread gets a complaint filed;
// subsequent reports attach as evidence.
export interface IssueThread {
  id: string;
  category: IssueCategory;
  wardId: string;
  centroid: GeoPoint;
  reportIds: string[]; // all RawReport ids folded into this thread
  reporterCount: number;
  firstReportedAt: string;
  lastReportedAt: string;
  status: "new" | "drafted" | "awaiting_confirm" | "submitted" | "in_progress" | "resolved" | "stale";
  complaintId?: string; // set once a Complaint is created for this thread

  // Escalation tracking. Auto-followups are safe to fire on a timer; anything
  // beyond that (public escalation, naming the authority) requires a human.
  autoFollowupCount: number;
  lastFollowupAt?: string;
  needsManualEscalation: boolean; // true once auto-followups are exhausted
}

export interface Complaint {
  id: string;
  issueThreadId: string;
  authority: AuthorityId;
  channel: SubmissionChannel;
  channelContact: string; // the WhatsApp number / email / API URL this went to
  draftText: string;
  attachedMediaUrls: string[];
  status: "drafted" | "awaiting_confirm" | "sent" | "acknowledged" | "resolved" | "failed";
  authorityReferenceId?: string; // the tracking ID the authority gives back, once we have it
  createdAt: string;
  sentAt?: string;
}
