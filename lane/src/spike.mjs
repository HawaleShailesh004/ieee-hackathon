// Spike: one citizen assessment -> transaction Bundle in build/spike/, ready for the HL7 validator.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { extract } from './extract.mjs';

const root = new URL('../../', import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root)));

const questionnaire = readJson('citizen-lane-ig/fsh-generated/resources/Questionnaire-CitizenStreamAssessmentOah.json');
const response = readJson('lane/fixtures/qr-almyros-foam.json');

const bundle = extract({
  questionnaire,
  response,
  contributorId: 'urn:uuid:5b0e7c1a-3f2d-4a8e-9b61-7f3a91c2d4e8',
  extractedAt: '2026-09-21T09:41:00+03:00',
  extractorName: 'oah-citizen-lane extractor 0.1.0',
});

const out = new URL('build/spike/', root);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('bundle.json', out), JSON.stringify(bundle, null, 2));
// Individual resources too: the validator reports per-resource profile errors more clearly.
bundle.entry.forEach((e, i) =>
  writeFileSync(new URL(`${String(i).padStart(2, '0')}-${e.resource.resourceType}.json`, out),
    JSON.stringify(e.resource, null, 2)));

// Negative controls: each must FAIL validation for exactly the stated reason.
const base = bundle.entry.find((e) => e.resource.resourceType === 'Observation').resource;
const negatives = {
  'no-citizen-category': { ...base, category: [] },
  'unknown-review-state': { ...base, meta: { ...base.meta, tag: [{ ...base.meta.tag[0], code: 'trusted' }] } },
  'identifiable-performer': { ...base, performer: [{ reference: 'Practitioner/jane-doe' }] },
  'preliminary-status': { ...base, status: 'preliminary' },
};
const negOut = new URL('build/spike-negative/', root);
mkdirSync(negOut, { recursive: true });
for (const [name, resource] of Object.entries(negatives)) {
  writeFileSync(new URL(`${name}.json`, negOut), JSON.stringify(resource, null, 2));
}

const counts = {};
for (const e of bundle.entry) counts[e.resource.resourceType] = (counts[e.resource.resourceType] ?? 0) + 1;
console.log('Wrote build/spike/bundle.json', counts);
