// Run with: npx tsx scripts/capture-jd-fixtures.ts
// Requires environment: SUPABASE_URL, SUPABASE_ANON_KEY, USER_JWT
// Hits the existing debug-spray-shape edge function and writes its response to __fixtures__/jd/.
// Manually anonymize IDs (replace org/field/operation IDs with synthetic UUIDs) before committing.

import { writeFile } from "node:fs/promises";
import path from "node:path";

const supabaseUrl = process.env.SUPABASE_URL;
const userJwt = process.env.USER_JWT;

if (!supabaseUrl || !userJwt) {
  console.error("Required: SUPABASE_URL, USER_JWT");
  process.exit(1);
}

const out = path.resolve(__dirname, "../__fixtures__/jd");

async function main() {
  const r = await fetch(`${supabaseUrl}/functions/v1/debug-spray-shape`, {
    headers: { Authorization: `Bearer ${userJwt}` },
  });
  const data = await r.json();
  const file = path.join(
    out,
    `debug-spray-shape-snapshot-${new Date().toISOString().slice(0, 10)}.json`,
  );
  await writeFile(file, JSON.stringify(data, null, 2));
  console.log(`Wrote ${file}`);
  console.log("Anonymize IDs before committing.");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
