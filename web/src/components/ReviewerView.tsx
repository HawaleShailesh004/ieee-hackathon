import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type CitizenObservation, type Decision, type ExchangeResult, type SiteDetail } from '../api';
import { formatTime, StateBadge } from '../format';
import { EvidenceTrail } from './EvidenceTrail';
import { LabContext } from './LabContext';

const DECISIONS: { value: Decision; label: string; hint: string }[] = [
  { value: 'accepted', label: 'Accept', hint: 'Usable as evidence for this site.' },
  { value: 'needs-follow-up', label: 'Request follow-up', hint: 'Worth a professional visit or sample.' },
  { value: 'rejected', label: 'Reject', hint: 'Not usable. It stays on record for audit.' },
];
const REVIEWED = ['accepted', 'needs-follow-up', 'rejected'];

export function ReviewerView({ refreshKey, onExchanged }: { refreshKey: number; onExchanged: () => void }) {
  const [queue, setQueue] = useState<CitizenObservation[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [site, setSite] = useState<SiteDetail | null>(null);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'review' | 'exchange' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<ExchangeResult | null>(null);

  const load = useCallback(() => api.queue().then((q) => {
    setQueue(q);
    setSelectedId((cur) => cur && q.some((o) => o.id === cur) ? cur : q.find((o) => !REVIEWED.includes(o.reviewState))?.id ?? q[0]?.id ?? null);
  }).catch((e) => setError(e.message)), []);

  useEffect(() => { load(); }, [load, refreshKey]);

  const selected = queue?.find((o) => o.id === selectedId) ?? null;
  useEffect(() => {
    setDecision(null); setReason('');
    if (!selected) return;
    const id = selected.site.split('/')[1];
    if (site?.id !== id) api.site(id).then(setSite).catch((e) => setError(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const reviewed = useMemo(() => queue?.filter((o) => REVIEWED.includes(o.reviewState)) ?? [], [queue]);
  const waiting = (queue?.length ?? 0) - reviewed.length;

  async function submitReview() {
    if (!selected || !decision) return;
    setBusy('review'); setError(null);
    try {
      await api.review(selected.id, decision, reason);
      await load();
      setSelectedId(queue?.find((o) => o.id !== selected.id && !REVIEWED.includes(o.reviewState))?.id ?? selected.id);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  async function sendToHealth() {
    setBusy('exchange'); setError(null);
    try {
      setSent(await api.exchange(reviewed.map((o) => o.id)));
      onExchanged();
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  const citizenNumber = selected?.value ? Number.parseFloat(selected.value) : NaN;

  return (
    <section className="reviewer">
      <aside className="queue" aria-label="Citizen reports">
        <div className="queue-head">
          <h2>Citizen reports</h2>
          <p className="muted">{queue ? `${waiting} waiting, ${reviewed.length} reviewed` : 'Loading…'}</p>
        </div>
        {queue?.length === 0 && <p className="empty">No reports yet. Send one from “Report a stream” to see it arrive here.</p>}
        <ul>
          {queue?.map((o) => (
            <li key={o.id}>
              <button type="button" className={`queue-item${o.id === selectedId ? ' is-selected' : ''}`} onClick={() => setSelectedId(o.id)}>
                <span className="queue-q">{o.question}</span>
                <span className="queue-v hand-citizen">{o.value}</span>
                <span className="queue-meta">{o.siteName ?? o.site}, {formatTime(o.effective)}</span>
                <StateBadge state={o.reviewState} />
              </button>
            </li>
          ))}
        </ul>
        <div className="handover">
          <button type="button" className="button" disabled={!reviewed.length || busy !== null} onClick={sendToHealth}>
            {busy === 'exchange' ? 'Sending…' : `Send ${reviewed.length} reviewed report${reviewed.length === 1 ? '' : 's'} to the health authority`}
          </button>
          {sent && (
            <p className={sent.verification.ok ? 'ok' : 'error'} role="status">
              {sent.verification.ok
                ? `Sent ${sent.moved.observations} reports with ${sent.moved.provenance} history records. The health authority's copy matches ours.`
                : 'Sent, but the health authority copy does not match. Open the health authority view for details.'}
            </p>
          )}
        </div>
      </aside>

      <div className="detail">
        {!selected ? <p className="empty">Select a report to review it.</p> : (
          <>
            <header className="detail-head">
              <p className="muted">{selected.siteName ?? selected.site}</p>
              <h2>{selected.question}: <span className="hand-citizen">{selected.value}</span></h2>
              <StateBadge state={selected.reviewState} />
            </header>

            <div className="detail-grid">
              <div>
                <h3>What the lab has recorded here</h3>
                {site?.id === selected.site.split('/')[1]
                  ? <LabContext series={site.lab} focusCode={selected.code} citizenValue={Number.isNaN(citizenNumber) ? undefined : citizenNumber} />
                  : <p className="muted">Loading lab records…</p>}

                {!REVIEWED.includes(selected.reviewState) ? (
                  <div className="decision">
                    <h3>Your decision</h3>
                    <div className="decision-options" role="radiogroup" aria-label="Decision">
                      {DECISIONS.map((d) => (
                        <label key={d.value} className={`decision-option decision-${d.value}${decision === d.value ? ' is-selected' : ''}`}>
                          <input type="radio" name="decision" value={d.value} checked={decision === d.value} onChange={() => setDecision(d.value)} />
                          <span className="decision-label">{d.label}</span>
                          <span className="decision-hint">{d.hint}</span>
                        </label>
                      ))}
                    </div>
                    <label className="field">
                      <span className="field-label">Reason (travels with the report)</span>
                      <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                        placeholder="For example: unusual for this reach after two dry weeks; request a sample" />
                    </label>
                    <button type="button" className="button" disabled={!decision || reason.trim().length < 3 || busy !== null} onClick={submitReview}>
                      {busy === 'review' ? 'Saving…' : 'Save decision'}
                    </button>
                  </div>
                ) : <p className="muted decided">This report has been reviewed. The decision and reason are in its history.</p>}
                {error && <p className="error" role="alert">{error}</p>}
              </div>

              <div>
                <h3>History</h3>
                <EvidenceTrail steps={selected.history} />
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
