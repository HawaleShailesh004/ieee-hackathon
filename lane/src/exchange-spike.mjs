// Check 4: one citizen assessment goes through its whole life on real FHIR servers and is moved from
// the city server (A) to the health server (B). Exits non-zero unless the history survives intact.
// Prerequisites: docker compose up -d; node scripts/seed.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fhirClient } from './fhir.mjs';
import { submitAssessment, automatedCheck, review, exchange, verifyExchange, ValidationFailed } from './workflow.mjs';

const root = new URL('../../', import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root)));
const city = fhirClient(process.env.FHIR_CITY_URL ?? 'http://localhost:8081/fhir');
const health = fhirClient(process.env.FHIR_HEALTH_URL ?? 'http://localhost:8082/fhir');

let clock = Date.parse('2026-09-21T06:41:00Z');
const tick = () => new Date((clock += 60_000)).toISOString();

try {
  const submitted = await submitAssessment(city, {
    questionnaire: readJson('citizen-lane-ig/fsh-generated/resources/Questionnaire-CitizenStreamAssessmentOah.json'),
    response: readJson('lane/fixtures/qr-almyros-foam.json'),
    contributorId: 'urn:uuid:5b0e7c1a-3f2d-4a8e-9b61-7f3a91c2d4e8',
    now: tick(),
    extractorName: 'oah-citizen-lane extractor 0.1.0',
    aiSuggestions: [{
      linkId: 'foam',
      coding: { system: 'http://hl7.eu/fhir/ig/oah/CodeSystem/temporarySystem-oah-eu', code: 'extensive' },
      quote: 'Brown foam collecting below the road culvert',
      model: 'openai/gpt-5.6-luna',
    }],
  });
  console.log(`1. Submitted: ${submitted.observations.length} observations, $validate passed for ${submitted.validation.length} resources`);

  const checks = await automatedCheck(city, submitted.observations, { now: tick(), checkerName: 'oah-citizen-lane plausibility rules 0.1.0' });
  for (const c of checks) console.log(`2. ${c.flag ? 'FLAG' : 'ok  '} ${c.finding}`);

  // Regression: run the exchange's history search before the reviews exist. A server-side search
  // cache used to answer the later exchange with this stale result and drop the review steps.
  await city.search('Provenance', { target: [...submitted.observations, submitted.questionnaireResponse].join(',') });

  const reviewer = { id: 'urn:uuid:9d2c4b7e-1a3f-4e6d-8b5a-2c7e9f1d3a6b', display: 'City water steward (demo)' };
  for (const c of checks) {
    const decision = c.flag ? 'needs-follow-up' : 'accepted';
    const reason = c.flag ? 'Citizen signal is unusual for this site; request a professional sample.' : 'Consistent with site conditions.';
    await review(city, c.observation, { decision, reason, reviewer, now: tick() });
  }
  console.log(`3. Reviewed ${checks.length} observations`);

  const moved = await exchange(city, health, submitted.observations, { now: tick(), receiverName: 'Regional public health FHIR server (demo)' });
  console.log('4. Exchanged:', moved.moved);

  const report = await verifyExchange(city, health, submitted.observations);
  for (const o of report.observations) {
    const failed = Object.entries(o.checks).filter(([, v]) => !v).map(([k]) => k);
    console.log(`5. ${o.ok ? 'PASS' : 'FAIL'} ${o.code} [${o.reviewState}] ${o.historySteps} history steps${failed.length ? ` failed: ${failed.join(', ')}` : ''}`);
  }
  mkdirSync(new URL('build/', root), { recursive: true });
  writeFileSync(new URL('build/exchange-report.json', root), JSON.stringify({ submitted, checks, moved, report }, null, 2));
  console.log(report.ok ? '\nCHECK 4 PASSED: history intact after exchange' : '\nCHECK 4 FAILED');
  process.exit(report.ok ? 0 : 1);
} catch (e) {
  if (e instanceof ValidationFailed) {
    for (const r of e.results.filter((x) => !x.valid)) console.error(r.resourceType, r.issues.map((i) => `${i.severity}: ${i.diagnostics}`).join('\n  '));
  }
  console.error(e.message);
  process.exit(1);
}
