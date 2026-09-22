import { useEffect, useMemo, useState } from 'react';
import { MyReports } from './MyReports';
import { api, contributorId, type Config, type QItem, type Questionnaire, type Site, type SubmitResult, type Suggestion, type Coding } from '../api';

type Answers = Record<string, { coding?: Coding; number?: number }>;

// Plain-language hints for the answer scales, so nobody needs the ecological vocabulary.
const HINT: Record<string, string> = {
  absent: 'None',
  present: 'Some',
  extensive: 'A lot',
  'non-native-species': 'One kind',
  'several-non-native-species': 'Several kinds',
  'unknown-non-native-species': "Yes, not sure what",
};

function answerItems(questionnaire: Questionnaire, answers: Answers) {
  const build = (items: QItem[]): unknown[] => items.flatMap((item): unknown[] => {
    if (item.type === 'group') {
      const children = build(item.item ?? []);
      return children.length ? [{ linkId: item.linkId, item: children }] : [];
    }
    const a = answers[item.linkId];
    if (item.type === 'choice' && a?.coding) return [{ linkId: item.linkId, answer: [{ valueCoding: a.coding }] }];
    if (item.type === 'quantity' && typeof a?.number === 'number' && !Number.isNaN(a.number)) {
      return [{ linkId: item.linkId, answer: [{ valueQuantity: { value: a.number, unit: '°C', system: 'http://unitsofmeasure.org', code: 'Cel' } }] }];
    }
    return [];
  });
  return build(questionnaire.item);
}

function ChoiceQuestion({ item, value, onChange, suggestedCode }: {
  item: QItem; value?: Coding; onChange: (c: Coding | undefined) => void; suggestedCode?: string;
}) {
  return (
    <fieldset className="question">
      <legend>{item.text}</legend>
      <div className="choices">
        {item.answerOption?.map(({ valueCoding }) => {
          const selected = value?.code === valueCoding.code;
          return (
            <button
              type="button"
              key={valueCoding.code}
              className={`choice${selected ? ' is-selected' : ''}${suggestedCode === valueCoding.code ? ' is-suggested' : ''}`}
              aria-pressed={selected}
              onClick={() => onChange(selected ? undefined : valueCoding)}
            >
              <span className="choice-main">{HINT[valueCoding.code] ?? valueCoding.display}</span>
              {HINT[valueCoding.code] && <span className="choice-sub">{valueCoding.display}</span>}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function CitizenView({ config, onSubmitted }: { config: Config | null; onSubmitted: () => void }) {
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [note, setNote] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [accepted, setAccepted] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState<'suggest' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [mode, setMode] = useState<'new' | 'mine'>('new');

  useEffect(() => {
    Promise.all([api.questionnaire(), api.sites()])
      .then(([q, s]) => {
        const streams = s.filter((x) => x.stream);
        setQuestionnaire(q); setSites(streams); setSiteId((cur) => cur || streams[0]?.id || '');
      })
      .catch((e) => setError(e.message));
  }, []);

  const groups = questionnaire?.item.filter((i) => i.type === 'group') ?? [];
  const answeredCount = useMemo(() => Object.values(answers).filter((a) => a.coding || typeof a.number === 'number').length, [answers]);
  const site = sites.find((s) => s.id === siteId);

  const setAnswer = (linkId: string, value: Answers[string] | undefined) => {
    setAnswers((prev) => {
      const next = { ...prev };
      if (value) next[linkId] = value; else delete next[linkId];
      return next;
    });
    // Changing an answer by hand withdraws the AI's credit for it.
    setAccepted((prev) => prev.filter((s) => s.linkId !== linkId || s.coding.code === value?.coding?.code));
  };

  async function suggest() {
    setBusy('suggest'); setError(null);
    try {
      const r = await api.suggest(note);
      setSuggestions(r.suggestions);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  function useSuggestion(s: Suggestion) {
    setAnswer(s.linkId, { coding: s.coding });
    setAccepted((prev) => [...prev.filter((x) => x.linkId !== s.linkId), s]);
    setSuggestions((prev) => prev?.filter((x) => x.linkId !== s.linkId) ?? null);
  }

  async function send() {
    if (!questionnaire || !siteId) return;
    setBusy('send'); setError(null);
    try {
      const r = await api.submit({ siteId, contributorId: contributorId(), items: answerItems(questionnaire, answers), note, aiSuggestions: accepted });
      setResult(r);
      onSubmitted();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  function reset() {
    setAnswers({}); setNote(''); setSuggestions(null); setAccepted([]); setResult(null); setError(null);
  }

  const modes = (
    <div className="citizen-modes" role="group" aria-label="Citizen views">
      <button type="button" className="citizen-mode" aria-pressed={mode === 'new'} onClick={() => setMode('new')}>New report</button>
      <button type="button" className="citizen-mode" aria-pressed={mode === 'mine'} onClick={() => setMode('mine')}>Your reports</button>
    </div>
  );

  if (mode === 'mine') {
    return (
      <section className="citizen">
        {modes}
        <MyReports onNewReport={() => { reset(); setMode('new'); }} />
      </section>
    );
  }

  if (result) {
    const flagged = result.checks.filter((c) => c.flag);
    return (
      <section className="citizen receipt" aria-live="polite">
        {modes}
        <h2>Report sent</h2>
        <p className="lede">
          Your {result.observations.length} answers about {site?.name ?? 'the stream'} are now observations the city can review.
          They are marked as a citizen report, so nobody will mistake them for lab results.
        </p>
        <ul className="receipt-list">
          {result.checks.map((c) => (
            <li key={c.observation} className={c.flag ? 'is-flagged' : ''}>
              <span className="receipt-mark" aria-hidden="true">{c.flag ? '!' : '✓'}</span>
              <span>
                <strong>{c.question}</strong> <span className="hand-citizen">{c.value}</span>
                <span className="receipt-status">{c.flag ? 'Unusual for this stream, so the city will look at it first.' : 'Recorded. A reviewer will check it.'}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="muted">
          {flagged.length
            ? `${flagged.length} answer${flagged.length > 1 ? 's were' : ' was'} flagged for a closer look. That is not a mistake on your part: unusual reports are exactly what the city needs to see.`
            : 'Nothing unusual was flagged. A reviewer will still look at every answer.'}
          {' '}Checked against the OneAquaHealth FHIR profiles: {result.validated} records valid.
        </p>
        <p>You can come back to <strong>Your reports</strong> to see what the city decides.</p>
        <div className="receipt-actions">
          <button type="button" className="button" onClick={() => setMode('mine')}>See your reports</button>
          <button type="button" className="button secondary" onClick={reset}>Report another visit</button>
        </div>
      </section>
    );
  }

  return (
    <section className="citizen">
      {modes}
      <header className="citizen-head">
        <h2>Report what you see at the stream</h2>
        <p className="lede">Describe what is there, not what you think caused it. Skip anything you are unsure about.</p>
      </header>

      <label className="field">
        <span className="field-label">Where are you?</span>
        <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {site && <span className="muted">{site.description}. The lab has {site.lab} records here.</span>}
      </label>

      {config?.aiEnabled && (
        <div className="note-first">
          <label className="field">
            <span className="field-label">In your own words (optional)</span>
            <textarea
              rows={3}
              value={note}
              placeholder="For example: brown foam below the road bridge, smells of sewage, lots of knotweed on the bank"
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <button type="button" className="button secondary" disabled={note.trim().length < 3 || busy !== null} onClick={suggest}>
            {busy === 'suggest' ? 'Reading your note…' : 'Suggest answers from my note'}
          </button>
          {suggestions && (
            <div className="suggestions" aria-live="polite">
              {suggestions.length === 0
                ? <p className="muted">Your note did not clearly answer any of the questions below. Please answer them directly.</p>
                : <p className="muted">Check each suggestion. Only the ones you use are kept, and the report records that they came from your note.</p>}
              {suggestions.map((s) => (
                <div className="suggestion" key={s.linkId}>
                  <p><strong>{s.text}</strong> {HINT[s.coding.code] ?? s.coding.display}</p>
                  <p className="quote">Because you wrote “{s.quote}”</p>
                  <div className="suggestion-actions">
                    <button type="button" className="button small" onClick={() => useSuggestion(s)}>Use this answer</button>
                    <button type="button" className="button small ghost" onClick={() => setSuggestions((p) => p?.filter((x) => x !== s) ?? null)}>Ignore</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {groups.map((group) => (
        <div className="question-group" key={group.linkId}>
          <h3>{group.text}</h3>
          {group.item?.map((item) => item.type === 'choice' ? (
            <ChoiceQuestion
              key={item.linkId}
              item={item}
              value={answers[item.linkId]?.coding}
              suggestedCode={accepted.find((s) => s.linkId === item.linkId)?.coding.code}
              onChange={(coding) => setAnswer(item.linkId, coding ? { coding } : undefined)}
            />
          ) : item.type === 'quantity' ? (
            <label className="field question" key={item.linkId}>
              <span className="field-label">{item.text}</span>
              <input
                type="number" inputMode="decimal" step="0.1" min="-5" max="50"
                value={answers[item.linkId]?.number ?? ''}
                onChange={(e) => setAnswer(item.linkId, e.target.value === '' ? undefined : { number: Number(e.target.value) })}
              />
            </label>
          ) : null)}
        </div>
      ))}

      {!config?.aiEnabled && (
        <label className="field">
          <span className="field-label">Anything else you noticed? (optional)</span>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      <div className="send-bar">
        <p className="muted">{answeredCount === 0 ? 'Answer at least one question to send a report.' : `${answeredCount} answer${answeredCount > 1 ? 's' : ''} ready. No name or account needed.`}</p>
        <button type="button" className="button" disabled={answeredCount === 0 || busy !== null || !siteId} onClick={send}>
          {busy === 'send' ? 'Sending…' : 'Send report'}
        </button>
      </div>
    </section>
  );
}
