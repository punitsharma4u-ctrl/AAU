import * as fs from "fs";
import * as path from "path";
import { pool } from "../db/spatialDedup";

// Runs db/schema.sql against whatever database DATABASE_URL (or the PG*
// vars) point to. Exists so schema setup doesn't require installing psql
// separately -- this project already depends on the pg package, so Node
// alone is enough.
async function runSchema() {
  const schemaPath = path.join(__dirname, "../../db/schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf-8");

  console.log("Running schema.sql against the configured database...");
  await pool.query(sql);
  console.log("Schema applied successfully.");

  const { rows } = await pool.query(`SELECT postgis_version();`);
  console.log("PostGIS version confirmed:", rows[0].postgis_version);

  await pool.end();
}

runSchema().catch((err) => {
  console.error("Failed to apply schema:", err.message);
  process.exit(1);
});
