// Citizen observation lifecycle on real FHIR servers:
// submit -> automated check -> expert review -> exchange to another system -> verify history survived.
// Every step writes a ProvenanceCitizenOah record; the current state is the review-state meta.tag.
import { extract, provenance, contributorIdentifier } from './extract.mjs';
import { CS_DATA_SOURCE, CS_REVIEW_STATE } from './constants.mjs';

const OAH_CS = 'http://hl7.eu/fhir/ig/oah/CodeSystem/temporarySystem-oah-eu';
const REVIEW_DISPLAY = {
  unreviewed: 'Unreviewed',
  'auto-checked': 'Automatically checked',
  accepted: 'Accepted by reviewer',
  rejected: 'Rejected by reviewer',
  'needs-follow-up': 'Needs field follow-up',
};
export const REVIEW_DECISIONS = ['accepted', 'rejected', 'needs-follow-up'];

// Lifecycle order, used to break ties between steps recorded at the same instant.
const LIFECYCLE = ['capture', 'ai-code-suggestion', 'extraction', 'automated-check', 'expert-review', 'exchange-import'];
const rank = (p) => LIFECYCLE.indexOf(p.activity.coding[0].code);
/** Chronological order of Provenance records (timestamps may carry different UTC offsets). */
export const chronological = (a, b) => Date.parse(a.recorded) - Date.parse(b.recorded) || rank(a) - rank(b);

const idFromLocation = (location) => location.split('/').slice(0, 2).join('/'); // "Observation/abc/_history/1"
const hasCode = (obs, code) => obs.code?.coding?.some((c) => c.system === OAH_CS && c.code === code);
export const isCitizen = (obs) => obs.category?.some((cat) => cat.coding?.some((c) => c.system === CS_DATA_SOURCE));
export const reviewState = (obs) => obs.meta?.tag?.find((t) => t.system === CS_REVIEW_STATE)?.code;

export class ValidationFailed extends Error {
  constructor(results) {
    super(`FHIR validation failed for ${results.filter((r) => !r.valid).length} resource(s)`);
    this.results = results;
  }
}

/** Extracts, validates on the server ($validate) and stores one citizen assessment. */
export async function submitAssessment(city, { questionnaire, response, contributorId, now, extractorName, aiSuggestions }) {
  const bundle = extract({ questionnaire, response, contributorId, extractedAt: now, extractorName, aiSuggestions });
  const toValidate = bundle.entry.filter((e) => ['Observation', 'Provenance'].includes(e.resource.resourceType));
  const results = await Promise.all(toValidate.map(async (e) => ({
    fullUrl: e.fullUrl,
    resourceType: e.resource.resourceType,
    ...(await city.validate(e.resource, e.resource.meta.profile[0])),
  })));
  if (results.some((r) => !r.valid)) throw new ValidationFailed(results);

  const reply = await city.transaction(bundle);
  const stored = reply.entry.map((e) => idFromLocation(e.response.location));
  return {
    questionnaireResponse: stored[0],
    observations: stored.filter((ref) => ref.startsWith('Observation/')),
    provenance: stored.filter((ref) => ref.startsWith('Provenance/')),
    validation: results,
  };
}

async function setReviewState(server, obs, state) {
  const current = obs.meta.tag.filter((t) => t.system === CS_REVIEW_STATE);
  if (current.length) await server.metaDelete('Observation', obs.id, current);
  const fresh = await server.read('Observation', obs.id);
  fresh.meta.tag = [
    ...(fresh.meta.tag ?? []).filter((t) => t.system !== CS_REVIEW_STATE),
    { system: CS_REVIEW_STATE, code: state, display: REVIEW_DISPLAY[state] },
  ];
  fresh.text.div = fresh.text.div.replace(/Citizen report \([^)]*\)/, `Citizen report (${state})`);
  return server.update(fresh);
}

// --- Automated plausibility rules -------------------------------------------------------
// These are prompts for a human reviewer, not ecological assessments.
const TEMP_BOUNDS_CEL = [0, 40]; // physically plausible for surface freshwater
const TEMP_MARGIN_CEL = 5;       // tolerance around the site's recorded lab readings

async function checkObservation(city, obs) {
  if (hasCode(obs, 'waterTemperature') && obs.valueQuantity) {
    const t = obs.valueQuantity.value;
    const lab = (await city.search('Observation', { subject: obs.subject.reference, code: `${OAH_CS}|waterTemperature` }))
      .filter((o) => !isCitizen(o) && o.valueQuantity?.code === 'Cel');
    const values = lab.map((o) => o.valueQuantity.value);
    const evidence = lab.map((o) => `Observation/${o.id}`);
    if (t < TEMP_BOUNDS_CEL[0] || t > TEMP_BOUNDS_CEL[1]) {
      return { flag: true, evidence, finding: `${t} °C is outside the physically plausible range for surface water (${TEMP_BOUNDS_CEL.join('–')} °C).` };
    }
    if (!values.length) return { flag: false, evidence, finding: `${t} °C is plausible; no lab temperature readings exist for this site to compare with.` };
    const [min, max] = [Math.min(...values), Math.max(...values)];
    const n = values.length;
    const inRange = t >= min - TEMP_MARGIN_CEL && t <= max + TEMP_MARGIN_CEL;
    return {
      flag: !inRange,
      evidence,
      finding: inRange
        ? `${t} °C is consistent with ${n} lab reading(s) at this site (${min}–${max} °C, ±${TEMP_MARGIN_CEL} °C).`
        : `${t} °C is outside ${n} lab reading(s) at this site (${min}–${max} °C, ±${TEMP_MARGIN_CEL} °C). Few readings: treat as a prompt to review, not an error.`,
    };
  }
  if (hasCode(obs, 'foam')) {
    const answer = obs.valueCodeableConcept?.coding?.[0]?.code;
    if (answer === 'present' || answer === 'extensive') {
      return { flag: true, evidence: [], finding: `Foam, unusual colour or smell reported as "${answer}". Possible pollution signal worth a reviewer's attention; not a diagnosis.` };
    }
    return { flag: false, evidence: [], finding: 'No foam, colour or smell reported.' };
  }
  return { flag: false, evidence: [], finding: 'No automated rule for this indicator; needs human review.' };
}

/** Runs plausibility rules on each observation, tags it auto-checked and records the finding. */
export async function automatedCheck(city, observationRefs, { now, checkerName }) {
  const results = [];
  for (const ref of observationRefs) {
    const obs = await city.read(...ref.split('/'));
    const result = await checkObservation(city, obs);
    await setReviewState(city, obs, 'auto-checked');
    const prov = await city.create(provenance({
      targets: [ref],
      activity: 'automated-check',
      recorded: now,
      reason: `${result.flag ? 'FLAGGED' : 'OK'}: ${result.finding}`,
      agents: [{ type: 'performer', who: { display: checkerName } }],
      entities: result.evidence.map((reference) => ({ role: 'source', what: { reference } })),
    }));
    const value = obs.valueQuantity ? `${obs.valueQuantity.value} ${obs.valueQuantity.unit ?? ''}`.trim()
      : obs.valueCodeableConcept?.coding?.[0]?.display;
    results.push({ observation: ref, question: obs.code.text, value, ...result, provenance: `Provenance/${prov.id}` });
  }
  return results;
}

/** A human reviewer's decision. The reason is mandatory and travels with the observation. */
export async function review(city, observationRef, { decision, reason, reviewer, now }) {
  if (!REVIEW_DECISIONS.includes(decision)) throw new Error(`Unknown decision "${decision}"`);
  if (!reason?.trim()) throw new Error('A review needs a reason');
  const obs = await city.read(...observationRef.split('/'));
  await setReviewState(city, obs, decision);
  const prov = await city.create(provenance({
    targets: [observationRef],
    activity: 'expert-review',
    recorded: now,
    reason: `${REVIEW_DISPLAY[decision]}: ${reason.trim()}`,
    agents: [{ type: 'verifier', who: { identifier: contributorIdentifier(reviewer.id), display: reviewer.display } }],
  }));
  return { observation: observationRef, state: decision, provenance: `Provenance/${prov.id}` };
}

/** Everything that must move with the citizen observations: themselves, their sources and all history. */
async function collectEvidence(server, observationRefs) {
  const observations = await Promise.all(observationRefs.map((ref) => server.read(...ref.split('/'))));
  const qrRefs = [...new Set(observations.flatMap((o) => o.derivedFrom.map((d) => d.reference)))];
  const locationRefs = [...new Set(observations.map((o) => o.subject.reference))];
  const [responses, provenance] = await Promise.all([
    Promise.all(qrRefs.map((ref) => server.read(...ref.split('/')))),
    server.search('Provenance', { target: [...observationRefs, ...qrRefs].join(',') }),
  ]);
  // Lab records an automated check cited as evidence travel too, so the receiver can see what was compared.
  const cited = [...new Set(provenance.flatMap((p) => (p.entity ?? []).map((e) => e.what.reference)))]
    .filter((ref) => ref?.startsWith('Observation/') && !observationRefs.includes(ref));
  const citedLab = await Promise.all(cited.map((ref) => server.read(...ref.split('/'))));
  const locations = await readLocationsWithParents(server, [...new Set([...locationRefs, ...citedLab.map((o) => o.subject.reference)])]);
  // ...and whatever those lab records point to (measuring device, performing organisation, specimen).
  const labRefs = [...new Set(citedLab.flatMap((o) => [
    o.device?.reference, o.specimen?.reference, ...(o.performer ?? []).map((p) => p.reference),
  ]).filter((ref) => ref && !ref.startsWith('http')))];
  const labContext = await Promise.all(labRefs.map((ref) => server.read(...ref.split('/'))));
  return { observations, responses, locations, provenance, citedLab: [...labContext, ...citedLab] };
}

/** Locations plus every Location they are partOf, parents first, so references resolve on the target. */
async function readLocationsWithParents(server, refs) {
  const seen = new Map();
  let pending = refs;
  while (pending.length) {
    const read = await Promise.all(pending.filter((r) => !seen.has(r)).map((r) => server.read(...r.split('/'))));
    for (const loc of read) seen.set(`Location/${loc.id}`, loc);
    pending = read.map((l) => l.partOf?.reference).filter((r) => r && !seen.has(r));
  }
  return [...seen.values()].reverse();
}

/**
 * Moves citizen observations and their full history from one FHIR server to another, keeping ids,
 * and records the move itself as an exchange-import Provenance pointing back at the source system.
 */
export async function exchange(source, target, observationRefs, { now, receiverName }) {
  const { observations, responses, locations, provenance: history, citedLab } = await collectEvidence(source, observationRefs);
  const put = (r) => ({ resource: stripServerMeta(r), request: { method: 'PUT', url: `${r.resourceType}/${r.id}` } });
  await target.transaction({
    resourceType: 'Bundle',
    type: 'transaction',
    entry: [...locations, ...citedLab, ...responses, ...observations, ...history].map(put),
  });
  const imported = await target.create(provenance({
    targets: observationRefs,
    activity: 'exchange-import',
    recorded: now,
    reason: `Imported ${observations.length} citizen observation(s) with ${history.length} history record(s) from ${source.base}`,
    agents: [{ type: 'custodian', who: { display: receiverName } }],
    entities: observationRefs.map((ref) => ({ role: 'source', what: { reference: `${source.base}/${ref}` } })),
  }));
  return {
    moved: { observations: observations.length, responses: responses.length, locations: locations.length, provenance: history.length, citedLabRecords: citedLab.length },
    importProvenance: `Provenance/${imported.id}`,
  };
}

function stripServerMeta(resource) {
  const { meta = {}, ...rest } = resource;
  const { versionId, lastUpdated, source, ...keep } = meta;
  return { ...rest, meta: keep };
}

const activities = (provs, ref) => provs
  .filter((p) => p.target.some((t) => t.reference === ref))
  .sort(chronological)
  .map((p) => ({ activity: p.activity.coding[0].code, reason: p.reason?.[0]?.text }));

/** Compares the source and target systems: is every observation and every history step intact? */
export async function verifyExchange(source, target, observationRefs) {
  const [a, b] = await Promise.all([collectEvidence(source, observationRefs), collectEvidence(target, observationRefs)]);
  const perObservation = observationRefs.map((ref, i) => {
    const [oa, ob] = [a.observations[i], b.observations[i]];
    const chainA = activities(a.provenance, ref);
    const chainB = activities(b.provenance, ref);
    const checks = {
      sameValue: JSON.stringify(oa.valueQuantity ?? oa.valueCodeableConcept) === JSON.stringify(ob.valueQuantity ?? ob.valueCodeableConcept),
      sameReviewState: reviewState(oa) === reviewState(ob),
      stillCitizen: isCitizen(ob),
      samePseudonymousContributor: oa.performer[0].identifier.value === ob.performer[0].identifier.value,
      historyIntact: JSON.stringify(chainA) === JSON.stringify(chainB.filter((s) => s.activity !== 'exchange-import')),
      // Independent of the comparison above: a decided report must carry its review step.
      reviewTravelled: !REVIEW_DECISIONS.includes(reviewState(ob)) || chainB.some((s) => s.activity === 'expert-review'),
      importRecorded: chainB.some((s) => s.activity === 'exchange-import'),
    };
    return { observation: ref, code: oa.code.text, reviewState: reviewState(ob), historySteps: chainB.length, checks, ok: Object.values(checks).every(Boolean) };
  });
  return { ok: perObservation.every((o) => o.ok), observations: perObservation };
}
