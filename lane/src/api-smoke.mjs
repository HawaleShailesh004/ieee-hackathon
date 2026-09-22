// End-to-end check through lane-service's HTTP API, as the web app uses it:
// submit -> review queue -> review -> exchange -> contributor sees the outcome -> health context.
// Usage: node src/api-smoke.mjs [baseUrl]   (default http://localhost:8090)
import { randomUUID } from 'node:crypto';

const base = process.argv[2] ?? process.env.LANE_URL ?? 'http://localhost:8090';
const contributor = `urn:uuid:${randomUUID()}`;
let failed = 0;
const isReviewed = (o) => ['accepted', 'rejected', 'needs-follow-up'].includes(o.reviewState);

async function call(path, body) {
  const res = await fetch(`${base}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  return data;
}
function check(ok, label) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failed += 1;
}

const OAH = 'http://hl7.eu/fhir/ig/oah/CodeSystem/temporarySystem-oah-eu';
const sites = await call('/sites');
const site = sites.find((s) => s.stream && s.id === 'Loc-Almyros');
check(Boolean(site) && site.lab > 0, 'Almyros is offered as a stream site with lab records');

const submitted = await call('/assessments', {
  siteId: site.id,
  contributorId: contributor,
  items: [
    { linkId: 'water', item: [
      { linkId: 'foam', answer: [{ valueCoding: { system: OAH, code: 'extensive', display: 'Extensive' } }] },
      { linkId: 'water-temperature', answer: [{ valueQuantity: { value: 31.5, unit: '°C', system: 'http://unitsofmeasure.org', code: 'Cel' } }] },
    ] },
    { linkId: 'in-stream', item: [
      { linkId: 'invasive', answer: [{ valueCoding: { system: OAH, code: 'non-native-species', display: 'Non-native species' } }] },
    ] },
  ],
  note: 'API smoke test',
});
check(submitted.observations.length === 3, 'Three answers became three Observations');
check(submitted.checks.filter((c) => c.flag).length === 2, 'Both unusual answers were flagged');

const queue = await call('/review-queue');
const visit = queue.filter((o) => submitted.observations.includes(`Observation/${o.id}`));
const mine = visit.filter((o) => o.code !== 'invasiveOrganisms'); // the two flagged answers
const waiting = visit.find((o) => o.code === 'invasiveOrganisms'); // unflagged, reviewed later
const lastMine = Math.max(...mine.map((o) => queue.indexOf(o)));
check(queue.indexOf(waiting) > lastMine, 'Flagged reports come before an unflagged one from the same visit');
const firstReviewed = queue.findIndex(isReviewed);
check(mine.length === 2 && (firstReviewed === -1 || lastMine < firstReviewed),
  'Flagged waiting reports come before reviewed ones in the queue');

for (const o of mine) await call(`/observations/${o.id}/review`, { decision: 'needs-follow-up', reason: 'Smoke test: sample this week' });
// Only the two reviewed answers are sent; the third answer of the same visit is still waiting.
const exchanged = await call('/exchange', { observationIds: mine.map((o) => o.id) });
check(exchanged.verification.ok, 'Partial visit exchanged and verified: the health authority copy matches');

const reports = await call(`/my-reports?contributor=${encodeURIComponent(contributor)}`);
const answers = reports.flatMap((r) => r.answers);
const reviewedAnswers = answers.filter((a) => a.id !== waiting.id);
const waitingAnswer = answers.find((a) => a.id === waiting.id);
check(reports.length === 1 && answers.length === 3, 'Contributor sees their one visit with three answers');
check(reviewedAnswers.every((a) => a.reviewState === 'needs-follow-up' && a.reviewReason === 'Smoke test: sample this week'),
  "Contributor sees the city's decision and reason");
check(reviewedAnswers.every((a) => a.sharedWithHealth), 'Contributor sees that reviewed answers reached the health authority');
check(waitingAnswer?.reviewState === 'auto-checked' && !waitingAnswer.sharedWithHealth,
  'The unreviewed answer stays with the city and is shown as waiting');

await call(`/observations/${waiting.id}/review`, { decision: 'accepted', reason: 'Smoke test: known on this bank' });
const rest = await call('/exchange', { observationIds: [waiting.id] });
check(rest.verification.ok, 'The rest of the visit follows later and also verifies');

const other = await call(`/my-reports?contributor=${encodeURIComponent(`urn:uuid:${randomUUID()}`)}`);
check(other.length === 0, "Another contributor sees none of these reports");

const context = await call('/health/context');
check(context.measures > 0 && context.places.length > 0, 'Health authority holds OAH population health measures');

console.log(failed ? `\n${failed} check(s) failed` : '\nAll API checks passed');
process.exit(failed ? 1 : 0);
