import * as fs from "fs";
import { pool } from "../db/spatialDedup";

// Imports the real Delhi ward boundaries published by DataMeet (CC BY 4.0),
// sourced from an ArcGIS Online map of the pre-2022 ward delimitation.
// Source: https://github.com/datameet/Municipal_Spatial_Data/tree/master/Delhi
//
// Authority is derived from the Ward_No prefix: NDMC_* -> NDMC, CANT_* ->
// Delhi Cantonment Board, everything else -> MCD (the three former
// corporations — North/South/East MCD — were unified into one MCD in 2022,
// so this mapping is correct for the current single-MCD structure even
// though the source data predates the merger).
//
// This is real geometry, not a placeholder — but it should still be spot-
// checked against a current MCD/NDMC boundary map before relying on it for
// live routing, since ward delimitations do get redrawn periodically.

interface WardFeature {
  type: "Feature";
  properties: { Ward_Name: string; Ward_No: string };
  geometry: { type: string; coordinates: any };
}

function resolveAuthorityFromWardNo(wardNo: string): string {
  if (wardNo.startsWith("NDMC")) return "NDMC";
  if (wardNo.startsWith("CANT")) return "DELHI_CANTONMENT";
  return "MCD";
}

async function importDelhiWards(geojsonPath: string) {
  const raw = fs.readFileSync(geojsonPath, "utf-8");
  const data = JSON.parse(raw) as { features: WardFeature[] };

  let imported = 0;
  let skipped = 0;

  for (const feature of data.features) {
    const wardNo = feature.properties.Ward_No;
    const wardName = feature.properties.Ward_Name;
    if (!wardNo || !feature.geometry) {
      skipped++;
      continue;
    }
    const authority = resolveAuthorityFromWardNo(wardNo);

    try {
      await pool.query(
        `INSERT INTO wards (ward_id, name, authority, boundary)
         VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromGeoJSON($4), 4326)::geography)
         ON CONFLICT (ward_id) DO UPDATE SET boundary = EXCLUDED.boundary, authority = EXCLUDED.authority`,
        [wardNo, wardName, authority, JSON.stringify(feature.geometry)],
      );
      imported++;
    } catch (err) {
      console.error(`Failed to import ward ${wardNo}:`, (err as Error).message);
      skipped++;
    }
  }

  console.log(`Imported ${imported} wards, skipped ${skipped}`);
  const byAuthority = await pool.query(`SELECT authority, count(*) FROM wards GROUP BY authority ORDER BY count(*) DESC`);
  console.log("By authority:", byAuthority.rows);
  await pool.end();
}

const path = process.argv[2] ?? "/tmp/delhi_wards.geojson";
importDelhiWards(path).catch((err) => {
  console.error(err);
  process.exit(1);
});
