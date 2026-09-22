// Loads the real OAH IG example data into a FHIR server, preserving resource ids.
// The data comes from fhir-packages/oah-example-data.json, which scripts/pack-packages.mjs builds from the OAH IG.
// Usage:
//   node scripts/seed.mjs [baseUrl]            city server: everything (default http://localhost:8081/fhir)
//   node scripts/seed.mjs [baseUrl] --health   health server: only the population health measures
//                                              (default http://localhost:8082/fhir), plus what they reference
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const healthOnly = args.includes('--health');
const base = args.find((a) => !a.startsWith('--'))
  ?? (healthOnly ? process.env.FHIR_HEALTH_URL ?? 'http://localhost:8082/fhir' : process.env.FHIR_CITY_URL ?? 'http://localhost:8081/fhir');
const HEALTH_MEASURE = 'http://hl7.eu/fhir/ig/oah/StructureDefinition/observation-health-measure-oah';

const bundle = JSON.parse(readFileSync(new URL('../fhir-packages/oah-example-data.json', import.meta.url), 'utf8'));
const all = bundle.entry.map((e) => e.resource);
const byRef = new Map(all.map((r) => [`${r.resourceType}/${r.id}`, r]));

/** The given resources plus everything they reference (transitively) that exists in the data. */
function withReferences(roots) {
  const picked = new Map();
  const visit = (r) => {
    const key = `${r.resourceType}/${r.id}`;
    if (picked.has(key)) return;
    picked.set(key, r);
    JSON.stringify(r, (k, v) => {
      if (k === 'reference' && byRef.has(v)) visit(byRef.get(v));
      return v;
    });
  };
  roots.forEach(visit);
  return [...picked.values()];
}

const selected = healthOnly
  ? withReferences(all.filter((r) => r.resourceType === 'Observation' && r.meta?.profile?.includes(HEALTH_MEASURE)))
  : all;
// Referenced resources first, so references resolve when referencing resources are written.
const ORDER = ['Organization', 'Device', 'Location', 'Group', 'Observation', 'Library'];
const rank = (r) => ORDER.indexOf(r.resourceType);
// Parent Locations before their children (partOf).
const depth = (r) => (r.partOf ? 1 + depth(byRef.get(r.partOf.reference) ?? {}) : 0);
const resources = selected.sort((a, b) => rank(a) - rank(b) || depth(a) - depth(b));

const CHUNK = 100;
for (let i = 0; i < resources.length; i += CHUNK) {
  const chunk = resources.slice(i, i + CHUNK);
  const res = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/fhir+json' },
    body: JSON.stringify({
      resourceType: 'Bundle',
      type: 'transaction',
      entry: chunk.map((r) => ({ resource: r, request: { method: 'PUT', url: `${r.resourceType}/${r.id}` } })),
    }),
  });
  if (!res.ok) {
    console.error(`Seed failed at ${i}: HTTP ${res.status}\n${(await res.text()).slice(0, 2000)}`);
    process.exit(1);
  }
}

const counts = {};
for (const r of resources) counts[r.resourceType] = (counts[r.resourceType] ?? 0) + 1;
console.log(`Seeded ${resources.length} OAH resources into ${base}`, counts);
