// Suggests coded answers from a citizen's free-text note. Suggestions are never stored directly:
// the contributor must confirm each one, and confirmed ones are recorded as ai-code-suggestion Provenance.
// Works with OpenAI or any OpenAI-compatible endpoint (e.g. OpenRouter) via OPENAI_BASE_URL.
import { SDC_OBS_EXTRACT } from './constants.mjs';

const NOT_MENTIONED = 'not_mentioned';

function choiceItems(questionnaire) {
  const walk = (items = []) => items.flatMap((i) => [i, ...walk(i.item)]);
  return walk(questionnaire.item).filter((i) =>
    i.type === 'choice' && i.answerOption?.length &&
    i.extension?.some((e) => e.url === SDC_OBS_EXTRACT && e.valueBoolean));
}

function schemaFor(items) {
  const properties = Object.fromEntries(items.map((i) => [i.linkId, {
    type: 'object',
    properties: {
      code: { type: 'string', enum: [...i.answerOption.map((o) => o.valueCoding.code), NOT_MENTIONED] },
      quote: { type: 'string', description: 'Exact words from the note that support this answer; empty if not_mentioned.' },
    },
    required: ['code', 'quote'],
    additionalProperties: false,
  }]));
  return { type: 'object', properties, required: items.map((i) => i.linkId), additionalProperties: false };
}

export function suggestConfig(env = process.env) {
  const apiKey = env.OPENAI_API_KEY;
  const isOpenRouter = apiKey?.startsWith('sk-or-');
  return {
    apiKey,
    baseUrl: (env.OPENAI_BASE_URL || (isOpenRouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1')).replace(/\/$/, ''),
    model: env.OPENAI_MODEL || (isOpenRouter ? 'openai/gpt-5.6-luna' : 'gpt-5.6-luna'),
  };
}

/**
 * @returns {Promise<{model: string, suggestions: {linkId, text, coding, quote}[]}>}
 *   Only items the note actually supports, with a quote from the note that must appear verbatim.
 */
export async function suggestAnswers({ questionnaire, note, config = suggestConfig() }) {
  if (!config.apiKey) throw new Error('AI suggestions are disabled: OPENAI_API_KEY is not set');
  const items = choiceItems(questionnaire);
  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      max_tokens: 800,
      messages: [
        {
          role: 'system',
          content: 'You map a citizen\'s note about an urban stream onto a fixed form. For each question, choose an answer '
            + `only if the note clearly states it; otherwise answer "${NOT_MENTIONED}". Never guess or infer causes. `
            + 'Quote the exact supporting words from the note.\n\nQuestions and allowed answers:\n'
            + items.map((i) => `- ${i.linkId}: ${i.text} [${i.answerOption.map((o) => `${o.valueCoding.code}=${o.valueCoding.display}`).join(', ')}]`).join('\n'),
        },
        { role: 'user', content: note },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'stream_form_answers', strict: true, schema: schemaFor(items) } },
    }),
  });
  if (!res.ok) throw new Error(`AI suggestion request failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
  const body = await res.json();
  const answers = JSON.parse(body.choices[0].message.content);

  const lowerNote = note.toLowerCase();
  const suggestions = items
    .map((i) => ({ item: i, answer: answers[i.linkId] }))
    // Drop anything not mentioned, and anything whose "quote" is not really in the note.
    .filter(({ answer }) => answer && answer.code !== NOT_MENTIONED && answer.quote && lowerNote.includes(answer.quote.toLowerCase()))
    .map(({ item, answer }) => ({
      linkId: item.linkId,
      text: item.text,
      coding: item.answerOption.find((o) => o.valueCoding.code === answer.code).valueCoding,
      quote: answer.quote,
    }));
  return { model: body.model ?? config.model, suggestions };
}
