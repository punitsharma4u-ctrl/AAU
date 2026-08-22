import { pool } from "./spatialDedup";

// Resolves a GPS point to the ward it falls inside, using a real
// point-in-polygon query against the wards table.
//
// This table is seeded with real Delhi ward boundaries (289 wards: 272 MCD,
// 9 NDMC, 8 Delhi Cantonment) from DataMeet's public GIS repository —
// see scripts/importWards.ts. That source predates the 2022 MCD merger of
// the three former corporations, so ward numbers reflect the old split, but
// authority attribution has been corrected for the current single-MCD
// structure. Worth a spot-check against a current official MCD/NDMC map
// before fully trusting it for live routing, since delimitations do shift.
export async function resolveWard(lat: number, lng: number): Promise<{ wardId: string; authority: string } | null> {
  const { rows } = await pool.query(
    `SELECT ward_id, authority
     FROM wards
     WHERE ST_Covers(boundary, ST_MakePoint($1, $2)::geography)
     LIMIT 1`,
    [lng, lat],
  );
  if (rows.length === 0) return null;
  return { wardId: rows[0].ward_id, authority: rows[0].authority };
}

// Imports ward polygons from a GeoJSON FeatureCollection. Each feature's
// properties must include ward_id, name, and authority. Run this once real
// boundary data is available (see LOADING_REAL_WARDS.md).
export async function importWardsFromGeoJson(
  featureCollection: { features: Array<{ properties: any; geometry: any }> },
): Promise<number> {
  let count = 0;
  for (const feature of featureCollection.features) {
    const { ward_id, name, authority } = feature.properties;
    await pool.query(
      `INSERT INTO wards (ward_id, name, authority, boundary)
       VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)::geography)
       ON CONFLICT (ward_id) DO UPDATE SET boundary = EXCLUDED.boundary, authority = EXCLUDED.authority`,
      [ward_id, name, authority, JSON.stringify(feature.geometry)],
    );
    count++;
  }
  return count;
}
