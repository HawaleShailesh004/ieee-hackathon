// lane-service: HTTP API for the citizen, reviewer and health-authority views, plus the built web app.
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fhirClient, FhirError } from './fhir.mjs';
import {
  submitAssessment, automatedCheck, review, exchange, verifyExchange,
  isCitizen, reviewState, chronological, ValidationFailed, REVIEW_DECISIONS,
} from './workflow.mjs';
import { suggestAnswers, suggestConfig } from './suggest.mjs';

const root = new URL('../../', import.meta.url);
const city = fhirClient(process.env.FHIR_CITY_URL ?? 'http://localhost:8081/fhir');
const health = fhirClient(process.env.FHIR_HEALTH_URL ?? 'http://localhost:8082/fhir');
const questionnaire = JSON.parse(readFileSync(new URL(
  'citizen-lane-ig/fsh-generated/resources/Questionnaire-CitizenStreamAssessmentOah.json', root)));
const ai = suggestConfig();
const REVIEWER = { id: 'urn:uuid:9d2c4b7e-1a3f-4e6d-8b5a-2c7e9f1d3a6b', display: 'City water steward (demo)' };
const EXTRACTOR = 'oah-citizen-lane extractor 0.1.0';
const CHECKER = 'oah-citizen-lane plausibility rules 0.1.0';
const RECEIVER = 'Regional public health FHIR server (demo)';
const UUID = /^urn:uuid:[0-9a-f-]{36}$/;
const SNOMED_RIVER = '420531007';
const HEALTH_MEASURE = 'http://hl7.eu/fhir/ig/oah/StructureDefinition/observation-health-measure-oah';
const now = () => new Date().toISOString();

const app = Fastify({ logger: { level: 'warn' } });

app.setErrorHandler((err, req, reply) => {
  if (err instanceof ValidationFailed) {
    return reply.code(422).send({ error: 'The assessment did not pass FHIR validation.', validation: err.results });
  }
  if (err instanceof FhirError) return reply.code(502).send({ error: `FHIR server error: ${err.message}` });
  if (err.validation) return reply.code(400).send({ error: err.message });
  req.log.error(err);
  return reply.code(err.statusCode ?? 500).send({ error: err.message });
});

// --- Shared read models ----------------------------------------------------------------------

function step(p, labels = {}) {
  const agent = p.agent?.[0];
  return {
    id: p.id,
    activity: p.activity.coding[0].code,
    recorded: p.recorded,
    reason: p.reason?.[0]?.text ?? null,
    agents: p.agent.map((a) => ({ role: a.type?.coding?.[0]?.code, who: a.who?.display ?? a.who?.identifier?.value ?? a.who?.reference })),
    sources: (p.entity ?? []).map((e) => e.what.reference),
    sourceLabels: (p.entity ?? []).map((e) => labels[e.what.reference] ?? e.what.reference.split('/')[1]),
    by: agent?.who?.display ?? agent?.who?.identifier?.value,
  };
}

function valueText(obs) {
  if (obs.valueQuantity) return `${obs.valueQuantity.value} ${obs.valueQuantity.unit ?? obs.valueQuantity.code ?? ''}`.trim();
  if (obs.valueCodeableConcept) return obs.valueCodeableConcept.coding?.[0]?.display ?? obs.valueCodeableConcept.coding?.[0]?.code;
  return null;
}

async function citizenObservations(server, params) {
  const all = await server.search('Observation', { category: 'https://hawaleshailesh004.github.io/ieee-hackathon/CodeSystem/oah-data-source|citizen-science', ...params });
  if (!all.length) return [];
  const sourcesOf = (o) => [`Observation/${o.id}`, ...(o.derivedFrom ?? []).map((d) => d.reference)];
  const targets = [...new Set(all.flatMap(sourcesOf))];
  const provs = await server.search('Provenance', { target: targets.join(',') });
  // Lab records a check compared against, labelled by value and month (they travel with an exchange).
  const cited = [...new Set(provs.flatMap((p) => (p.entity ?? []).map((e) => e.what.reference)))]
    .filter((r) => r.startsWith('Observation/'));
  const labels = {};
  if (cited.length) {
    for (const o of await server.search('Observation', { _id: cited.map((r) => r.split('/')[1]).join(',') })) {
      const date = (o.effectiveDateTime ?? o.effectivePeriod?.start ?? '').slice(0, 7);
      labels[`Observation/${o.id}`] = `${valueText(o)?.replace(/ Celsius$/, ' °C') ?? o.id}${date ? ` (${date})` : ''}`;
    }
  }
  return all.map((o) => ({
    id: o.id,
    site: o.subject.reference,
    siteName: o.subject.display ?? null,
    code: o.code.coding[0].code,
    question: o.code.text,
    value: valueText(o),
    effective: o.effectiveDateTime,
    contributor: o.performer?.[0]?.identifier?.value,
    reviewState: reviewState(o),
    history: provs
      // Its own steps plus the capture of the report it was extracted from.
      .filter((p) => p.target.some((t) => sourcesOf(o).includes(t.reference)))
      .sort(chronological)
      .map((p) => step(p, labels)),
  })).sort((a, b) => Date.parse(b.effective) - Date.parse(a.effective));
}

// --- API -----------------------------------------------------------------------------------

app.get('/api/config', async () => ({
  aiEnabled: Boolean(ai.apiKey),
  aiModel: ai.apiKey ? ai.model : null,
  servers: { city: city.base, health: health.base },
}));

app.get('/api/questionnaire', async () => questionnaire);

app.get('/api/sites', async () => {
  const [locations, observations] = await Promise.all([
    city.search('Location'),
    city.search('Observation', { _elements: 'subject,category' }),
  ]);
  const counts = {};
  for (const o of observations) {
    const c = (counts[o.subject?.reference] ??= { lab: 0, citizen: 0 });
    if (isCitizen(o)) c.citizen += 1; else c.lab += 1;
  }
  return locations
    .map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description ?? null,
      position: l.position ? { lat: l.position.latitude, lon: l.position.longitude } : null,
      // A reach a citizen can stand at: typed as a river and located. The IG's Benevento sites are
      // air-quality stations and Nordre Aker is a borough with health data, so they are excluded.
      stream: Boolean(l.position) && l.type?.some((t) => t.coding?.some((c) => c.system === 'http://snomed.info/sct' && c.code === SNOMED_RIVER)),
      ...(counts[`Location/${l.id}`] ?? { lab: 0, citizen: 0 }),
    }))
    // Sites with observations first; the IG also has parent Locations with no data of their own.
    .sort((a, b) => (b.lab + b.citizen) - (a.lab + a.citizen) || a.name.localeCompare(b.name));
});

app.get('/api/sites/:id', async (req) => {
  const ref = `Location/${req.params.id}`;
  const [location, observations, citizen] = await Promise.all([
    city.read('Location', req.params.id),
    city.search('Observation', { subject: ref }),
    citizenObservations(city, { subject: ref }),
  ]);
  const series = {};
  for (const o of observations.filter((x) => !isCitizen(x))) {
    const code = o.code.coding[0].code;
    const s = (series[code] ??= { code, name: o.code.text ?? o.code.coding[0].display ?? code, unit: null, points: [] });
    const q = o.valueQuantity ?? o.component?.find((c) => c.code.coding[0].code === 'average')?.valueQuantity;
    s.unit ??= q?.unit ?? q?.code ?? null;
    s.points.push({
      id: o.id,
      date: o.effectiveDateTime ?? o.effectivePeriod?.start ?? null,
      value: q?.value ?? null,
      text: q ? null : valueText(o),
      performer: o.performer?.[0]?.display ?? null,
    });
  }
  for (const s of Object.values(series)) s.points.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  return {
    id: location.id,
    name: location.name,
    description: location.description ?? null,
    lab: Object.values(series).sort((a, b) => b.points.length - a.points.length),
    citizen,
  };
});

app.post('/api/suggest', {
  schema: { body: { type: 'object', required: ['note'], properties: { note: { type: 'string', minLength: 3, maxLength: 2000 } } } },
}, async (req, reply) => {
  if (!ai.apiKey) return reply.code(503).send({ error: 'Answer suggestions are turned off on this server.' });
  return suggestAnswers({ questionnaire, note: req.body.note, config: ai });
});

app.post('/api/assessments', {
  schema: {
    body: {
      type: 'object',
      required: ['siteId', 'contributorId', 'items'],
      properties: {
        siteId: { type: 'string' },
        contributorId: { type: 'string', pattern: UUID.source },
        items: { type: 'array' },
        note: { type: 'string', maxLength: 2000 },
        aiSuggestions: { type: 'array' },
      },
    },
  },
}, async (req, reply) => {
  const { siteId, contributorId, items, note, aiSuggestions = [] } = req.body;
  const location = await city.read('Location', siteId);
  const authored = now();
  const response = {
    resourceType: 'QuestionnaireResponse',
    questionnaire: `${questionnaire.url}|${questionnaire.version}`,
    status: 'completed',
    subject: { reference: `Location/${location.id}`, display: location.name },
    authored,
    author: { identifier: { system: 'urn:ietf:rfc:3986', value: contributorId } },
    item: [...items, ...(note?.trim() ? [{ linkId: 'notes', answer: [{ valueString: note.trim() }] }] : [])],
  };
  const submitted = await submitAssessment(city, {
    questionnaire, response, contributorId, now: authored, extractorName: EXTRACTOR,
    aiSuggestions: aiSuggestions.map((s) => ({ ...s, model: ai.model })),
  });
  if (!submitted.observations.length) {
    return reply.code(400).send({ error: 'Answer at least one question about the stream before sending.' });
  }
  const checks = await automatedCheck(city, submitted.observations, { now: now(), checkerName: CHECKER });
  return { observations: submitted.observations, checks, validated: submitted.validation.length };
});

app.get('/api/review-queue', async () => citizenObservations(city));

app.post('/api/observations/:id/review', {
  schema: {
    body: {
      type: 'object',
      required: ['decision', 'reason'],
      properties: { decision: { enum: REVIEW_DECISIONS }, reason: { type: 'string', minLength: 3, maxLength: 1000 } },
    },
  },
}, async (req) => review(city, `Observation/${req.params.id}`, { ...req.body, reviewer: REVIEWER, now: now() }));

app.post('/api/exchange', {
  schema: { body: { type: 'object', required: ['observationIds'], properties: { observationIds: { type: 'array', minItems: 1, items: { type: 'string' } } } } },
}, async (req) => {
  const refs = req.body.observationIds.map((id) => `Observation/${id}`);
  const moved = await exchange(city, health, refs, { now: now(), receiverName: RECEIVER });
  const verification = await verifyExchange(city, health, refs);
  return { ...moved, verification };
});

app.get('/api/health/observations', async () => citizenObservations(health));

app.get('/api/health/verify', async () => {
  const received = await health.search('Observation', { category: 'https://hawaleshailesh004.github.io/ieee-hackathon/CodeSystem/oah-data-source|citizen-science', _elements: 'id' });
  if (!received.length) return { ok: true, observations: [] };
  return verifyExchange(city, health, received.map((o) => `Observation/${o.id}`));
});

// Population health measures the health authority already holds in OAH format (seeded from the IG).
// Summarised per place and indicator: the range across population groups.
app.get('/api/health/context', async () => {
  const [measures, locations] = await Promise.all([
    health.search('Observation', { _profile: HEALTH_MEASURE }),
    health.search('Location'),
  ]);
  const loc = new Map(locations.map((l) => [`Location/${l.id}`, l]));
  const top = (ref) => {
    let l = loc.get(ref);
    while (l?.partOf && loc.has(l.partOf.reference)) l = loc.get(l.partOf.reference);
    return l;
  };
  const places = new Map();
  for (const o of measures) {
    const q = o.valueQuantity;
    const placeLoc = top(o.subject.reference);
    if (!q || !placeLoc) continue;
    const place = places.get(placeLoc.id) ?? {
      id: placeLoc.id, name: placeLoc.name, description: placeLoc.description ?? null,
      groups: new Set(), years: new Set(), indicators: new Map(),
    };
    places.set(placeLoc.id, place);
    for (const f of o.focus ?? []) place.groups.add(f.reference);
    const year = (o.effectivePeriod?.start ?? o.effectiveDateTime ?? '').slice(0, 4);
    if (year) place.years.add(year);
    const code = o.code.coding[0];
    const ind = place.indicators.get(code.code) ?? { code: code.code, name: code.display ?? code.code, unit: q.unit ?? q.code, values: [] };
    place.indicators.set(code.code, ind);
    ind.values.push(q.value);
  }
  return {
    measures: measures.length,
    places: [...places.values()].map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      groups: p.groups.size,
      years: [...p.years].sort(),
      indicators: [...p.indicators.values()].map(({ values, ...i }) => ({
        ...i, records: values.length, min: Math.min(...values), max: Math.max(...values),
      })),
    })),
  };
});

// --- Web app -------------------------------------------------------------------------------

const dist = fileURLToPath(new URL('web/dist/', root));
if (existsSync(dist)) {
  await app.register(fastifyStatic, { root: dist });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html')));
}

const port = Number(process.env.PORT ?? 8090);
await app.listen({ port, host: process.env.HOST ?? 'localhost' });
console.log(`lane-service on http://localhost:${port} (city ${city.base}, health ${health.base}, AI ${ai.apiKey ? ai.model : 'off'})`);
