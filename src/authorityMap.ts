import { AuthorityId, IssueCategory, SubmissionChannel } from "./types";

// IMPORTANT: this is a starter table, not a complete one.
// Real routing needs two lookups you'll need to populate properly before launch:
//   1. wardId -> zone authority (MCD zone vs NDMC vs Delhi Cantonment).
//      Category alone is not enough — a pothole in Connaught Place goes to
//      NDMC, the same pothole in Rohini goes to MCD. This file assumes every
//      wardId maps to MCD unless explicitly listed in NDMC_WARDS below.
//   2. Category -> which of MCD's or the utility's *specific* channel to use.
//
// The category table below is authority-general; ward overrides refine it.

export interface AuthorityRoute {
  authority: AuthorityId;
  channel: SubmissionChannel;
  contact: string; // WhatsApp number, email address, or API base URL depending on channel
}

// Wards that fall under NDMC jurisdiction instead of MCD.
// Populate this with the real NDMC ward/area list before launch — this is a placeholder.
export const NDMC_WARDS = new Set<string>(["NDMC_CP", "NDMC_LUTYENS"]);

// Category -> default authority + channel, assuming MCD jurisdiction.
// power_outage/power_fault route by DISCOM, which itself is area-dependent
// (BRPL vs BYPL vs Tata Power-DDL) — see resolveDiscom() below.
const CATEGORY_ROUTES: Record<IssueCategory, AuthorityRoute> = {
  garbage: { authority: "MCD", channel: "open311_api", contact: "https://mcd.everythingcivic.com/api" },
  pothole: { authority: "MCD", channel: "open311_api", contact: "https://mcd.everythingcivic.com/api" },
  streetlight: { authority: "MCD", channel: "open311_api", contact: "https://mcd.everythingcivic.com/api" },
  stray_animals: { authority: "MCD", channel: "open311_api", contact: "https://mcd.everythingcivic.com/api" },

  water_supply: { authority: "DJB", channel: "whatsapp_business_api", contact: "9650291021" },
  sewage: { authority: "DJB", channel: "whatsapp_business_api", contact: "9650291021" },
  illegal_boring: { authority: "DJB", channel: "email", contact: "grievances-djb@delhi.gov.in" },

  // Placeholder default — actual DISCOM is resolved per-report via resolveDiscom()
  power_outage: { authority: "BRPL", channel: "whatsapp_business_api", contact: "9999919123" },
  power_fault: { authority: "BRPL", channel: "whatsapp_business_api", contact: "9999919123" },

  road_state_highway: { authority: "PWD", channel: "assisted_portal_link", contact: "pwd-grievance@delhi.gov.in" },
  parks_encroachment: { authority: "DDA", channel: "assisted_portal_link", contact: "dda-grievance@dda.gov.in" },

  other: { authority: "MCD", channel: "assisted_portal_link", contact: "https://mcd.everythingcivic.com" },
};

// DISCOM service areas are geographic, not ward-aligned 1:1 with MCD zones.
// Replace this stub with a real BRPL/BYPL/Tata Power-DDL polygon lookup.
export function resolveDiscom(wardId: string): AuthorityRoute {
  if (wardId.startsWith("BYPL_")) {
    return { authority: "BYPL", channel: "whatsapp_business_api", contact: "8745999808" };
  }
  if (wardId.startsWith("TPDDL_")) {
    return { authority: "TATA_POWER_DDL", channel: "assisted_portal_link", contact: "19124" };
  }
  return { authority: "BRPL", channel: "whatsapp_business_api", contact: "9999919123" };
}

export function resolveAuthority(category: IssueCategory, wardId: string): AuthorityRoute {
  if (category === "power_outage" || category === "power_fault") {
    return resolveDiscom(wardId);
  }

  const isNdmc = NDMC_WARDS.has(wardId) || wardId.startsWith("NDMC");
  const isCantonment = wardId.startsWith("CANT");
  const base = CATEGORY_ROUTES[category];

  if (isCantonment && (category === "garbage" || category === "pothole" || category === "streetlight" || category === "stray_animals")) {
    // Delhi Cantonment Board runs its own civic administration, separate
    // from MCD, with no public API — same assisted pattern as NDMC.
    return { authority: "DELHI_CANTONMENT", channel: "assisted_portal_link", contact: "cantonment-grievance@delhicantt.gov.in" };
  }

  if (isNdmc && (category === "garbage" || category === "pothole" || category === "streetlight" || category === "stray_animals")) {
    // NDMC has no public Open311-style API — falls back to assisted submission.
    return { authority: "NDMC", channel: "assisted_portal_link", contact: "ndmc-grievance@ndmc.gov.in" };
  }

  return base;
}

// Categories that must never auto-submit, regardless of channel availability.
// Anything touching law-and-order stays citizen-confirmed by design.
export const REQUIRES_CITIZEN_CONFIRM: ReadonlySet<IssueCategory> = new Set([]);
