import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extract } from '../src/extract.mjs';
import { CS_ACTIVITY, CS_DATA_SOURCE, CS_REVIEW_STATE, PROFILE_CITIZEN_OBS } from '../src/constants.mjs';

const root = new URL('../../', import.meta.url);
const questionnaire = JSON.parse(readFileSync(new URL('citizen-lane-ig/fsh-generated/resources/Questionnaire-CitizenStreamAssessmentOah.json', root)));
const response = JSON.parse(readFileSync(new URL('lane/fixtures/qr-almyros-foam.json', root)));
const OAH_CS = 'http://hl7.eu/fhir/ig/oah/CodeSystem/temporarySystem-oah-eu';

const run = (extra = {}) => extract({
  questionnaire, response, contributorId: 'urn:uuid:5b0e7c1a-3f2d-4a8e-9b61-7f3a91c2d4e8',
  extractedAt: '2026-09-21T06:41:00Z', extractorName: 'test', ...extra,
});
const ofType = (bundle, type) => bundle.entry.map((e) => e.resource).filter((r) => r.resourceType === type);
const activity = (p) => p.activity.coding[0].code;

test('one Observation per answered extractable item; free-text notes are not extracted', () => {
  const obs = ofType(run(), 'Observation');
  assert.deepEqual(obs.map((o) => o.code.coding[0].code).sort(), ['foam', 'herbaceous', 'invasiveOrganisms', 'trees', 'waterTemperature']);
});

test('citizen Observations are profiled, categorised, unreviewed and pseudonymous', () => {
  for (const o of ofType(run(), 'Observation')) {
    assert.equal(o.meta.profile[0], PROFILE_CITIZEN_OBS);
    assert.equal(o.status, 'final');
    assert.equal(o.category[0].coding[0].system, CS_DATA_SOURCE);
    assert.deepEqual(o.meta.tag.map((t) => [t.system, t.code]), [[CS_REVIEW_STATE, 'unreviewed']]);
    assert.equal(o.performer[0].reference, undefined);
    assert.match(o.performer[0].identifier.value, /^urn:uuid:/);
    assert.equal(o.subject.reference, 'Location/Loc-Almyros');
  }
});

test('every Observation traces back to the QuestionnaireResponse and an extraction Provenance', () => {
  const bundle = run();
  const qrUrl = bundle.entry.find((e) => e.resource.resourceType === 'QuestionnaireResponse').fullUrl;
  const obsUrls = bundle.entry.filter((e) => e.resource.resourceType === 'Observation').map((e) => e.fullUrl);
  const extraction = ofType(bundle, 'Provenance').find((p) => activity(p) === 'extraction');
  assert.ok(ofType(bundle, 'Observation').every((o) => o.derivedFrom[0].reference === qrUrl));
  assert.deepEqual(extraction.target.map((t) => t.reference).sort(), obsUrls.sort());
  assert.equal(extraction.activity.coding[0].system, CS_ACTIVITY);
});

test('AI suggestion is credited only when the contributor kept the suggested answer', () => {
  const kept = { linkId: 'foam', coding: { system: OAH_CS, code: 'extensive' }, quote: 'Brown foam', model: 'm' };
  const changed = { linkId: 'trees', coding: { system: OAH_CS, code: '81-100-percent' }, quote: 'trees', model: 'm' };
  const bundle = run({ aiSuggestions: [kept, changed] });
  const ai = ofType(bundle, 'Provenance').filter((p) => activity(p) === 'ai-code-suggestion');
  assert.equal(ai.length, 1);
  const foamUrl = bundle.entry.find((e) => e.resource.code?.coding[0].code === 'foam').fullUrl;
  assert.equal(ai[0].target[0].reference, foamUrl);
  assert.match(ai[0].reason[0].text, /confirmed by the contributor/);
});

test('transaction entries POST every resource', () => {
  const bundle = run();
  assert.equal(bundle.type, 'transaction');
  assert.ok(bundle.entry.every((e) => e.request.method === 'POST' && e.request.url === e.resource.resourceType));
});
