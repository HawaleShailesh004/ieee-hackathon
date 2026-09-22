// Observation-based extraction (SDC) of a citizen stream assessment into
// OAH citizen Observations, plus the Provenance records that start their history.
import { randomUUID } from 'node:crypto';
import {
  PROFILE_CITIZEN_OBS, PROFILE_CITIZEN_PROV, CS_DATA_SOURCE, CS_REVIEW_STATE,
  CS_ACTIVITY, CONTRIBUTOR_ID_SYSTEM, SDC_OBS_EXTRACT, PROV_PARTICIPANT,
} from './constants.mjs';

const urn = () => `urn:uuid:${randomUUID()}`;

const escapeXml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function narrative(text) {
  return { status: 'generated', div: `<div xmlns="http://www.w3.org/1999/xhtml">${escapeXml(text)}</div>` };
}

function displayValue(answer) {
  if (answer.valueCoding) return answer.valueCoding.display ?? answer.valueCoding.code;
  const q = answer.valueQuantity;
  return `${q.value} ${q.unit ?? q.code}`;
}

function flattenItems(items = []) {
  return items.flatMap((item) => [item, ...flattenItems(item.item)]);
}

function isExtractable(qItem) {
  return (qItem.extension ?? []).some((e) => e.url === SDC_OBS_EXTRACT && e.valueBoolean === true);
}

function toValue(answer) {
  if (answer.valueCoding) return { valueCodeableConcept: { coding: [answer.valueCoding] } };
  if (answer.valueQuantity) return { valueQuantity: answer.valueQuantity };
  throw new Error(`Unsupported answer type: ${Object.keys(answer).join(',')}`);
}

export function contributorIdentifier(contributorId) {
  return { system: CONTRIBUTOR_ID_SYSTEM, value: contributorId };
}

export function provenance({ targets, activity, recorded, agents, entities = [], reason }) {
  return {
    resourceType: 'Provenance',
    meta: { profile: [PROFILE_CITIZEN_PROV] },
    text: narrative(`Citizen observation lifecycle step: ${activity}${reason ? ` (${reason})` : ''}`),
    target: targets.map((reference) => ({ reference })),
    recorded,
    activity: { coding: [{ system: CS_ACTIVITY, code: activity }] },
    ...(reason && { reason: [{ text: reason }] }),
    agent: agents.map(({ type, who }) => ({
      type: { coding: [{ system: PROV_PARTICIPANT, code: type }] },
      who,
    })),
    ...(entities.length && { entity: entities }),
  };
}

/**
 * @returns a FHIR transaction Bundle containing the QuestionnaireResponse, one
 * Observation per answered extractable item, and capture + extraction Provenance.
 */
export function extract({ questionnaire, response, contributorId, extractedAt, extractorName, aiSuggestions = [] }) {
  const qItems = new Map(flattenItems(questionnaire.item).map((i) => [i.linkId, i]));
  const qrUrl = urn();
  const performer = { identifier: contributorIdentifier(contributorId) };

  const observations = flattenItems(response.item)
    .filter((ri) => ri.answer?.length && isExtractable(qItems.get(ri.linkId) ?? {}))
    .map((ri) => {
      const qi = qItems.get(ri.linkId);
      return {
        linkId: ri.linkId,
        answer: ri.answer[0],
        fullUrl: urn(),
        resource: {
          resourceType: 'Observation',
          meta: {
            profile: [PROFILE_CITIZEN_OBS],
            tag: [{ system: CS_REVIEW_STATE, code: 'unreviewed', display: 'Unreviewed' }],
          },
          text: narrative(`Citizen report (unreviewed): ${qi.text} = ${displayValue(ri.answer[0])}`),
          status: 'final',
          category: [{ coding: [{ system: CS_DATA_SOURCE, code: 'citizen-science', display: 'Citizen science' }] }],
          code: { coding: qi.code, text: qi.text },
          subject: response.subject,
          effectiveDateTime: response.authored,
          performer: [performer],
          ...toValue(ri.answer[0]),
          derivedFrom: [{ reference: qrUrl }],
        },
      };
    });

  const capture = provenance({
    targets: [qrUrl],
    activity: 'capture',
    recorded: response.authored,
    agents: [{ type: 'author', who: performer }],
  });
  const extraction = provenance({
    targets: observations.map((o) => o.fullUrl),
    activity: 'extraction',
    recorded: extractedAt,
    agents: [
      { type: 'assembler', who: { display: extractorName } },
      { type: 'author', who: performer },
    ],
    entities: [{ role: 'source', what: { reference: qrUrl } }],
  });

  // An AI suggestion is credited only where the contributor kept the suggested answer.
  const aiAssisted = aiSuggestions.flatMap((s) => {
    const obs = observations.find((o) => o.linkId === s.linkId && o.answer.valueCoding?.code === s.coding.code);
    return obs ? [provenance({
      targets: [obs.fullUrl],
      activity: 'ai-code-suggestion',
      recorded: response.authored,
      reason: `Suggested by ${s.model} from the contributor's note ("${s.quote}"); confirmed by the contributor.`,
      agents: [
        { type: 'assembler', who: { display: s.model } },
        { type: 'author', who: performer },
      ],
      entities: [{ role: 'source', what: { reference: qrUrl } }],
    })] : [];
  });

  const responseWithText = response.text ? response : {
    ...response,
    text: narrative(`Citizen stream assessment of ${response.subject?.display ?? response.subject?.reference}, ${response.authored}`),
  };
  const entry = [
    { fullUrl: qrUrl, resource: responseWithText },
    ...observations.map(({ fullUrl, resource }) => ({ fullUrl, resource })),
    { fullUrl: urn(), resource: capture },
    ...aiAssisted.map((resource) => ({ fullUrl: urn(), resource })),
    { fullUrl: urn(), resource: extraction },
  ];
  return {
    resourceType: 'Bundle',
    type: 'transaction',
    entry: entry.map((e) => ({ ...e, request: { method: 'POST', url: e.resource.resourceType } })),
  };
}
