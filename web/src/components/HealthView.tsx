import { useEffect, useState } from 'react';
import { api, type CitizenObservation, type Verification, type VerificationRow } from '../api';
import { StateBadge } from '../format';
import { EvidenceTrail } from './EvidenceTrail';
import { HealthContext } from './HealthContext';

const CHECK_LABEL: Record<keyof VerificationRow['checks'], string> = {
  sameValue: 'Same answer',
  sameReviewState: 'Same review decision',
  stillCitizen: 'Still marked as a citizen report',
  samePseudonymousContributor: 'Same pseudonymous contributor',
  historyIntact: 'Every earlier history step present',
  reviewTravelled: "The city's review decision and reason arrived",
  importRecorded: 'Arrival recorded',
};

export function HealthView({ refreshKey }: { refreshKey: number }) {
  const [received, setReceived] = useState<CitizenObservation[] | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.received(), api.verify()])
      .then(([r, v]) => { setReceived(r); setVerification(v); setOpenId((cur) => cur ?? r[0]?.id ?? null); })
      .catch((e) => setError(e.message));
  }, [refreshKey]);

  const rowFor = (id: string) => verification?.observations.find((v) => v.observation === `Observation/${id}`);
  const passed = verification?.observations.filter((v) => v.ok).length ?? 0;

  return (
    <section className="health">
      <header className="health-head">
        <h2>Received from the city</h2>
        <p className="lede">
          Citizen reports as they arrived in the regional public health system. Each one keeps its full history,
          and is compared with the city's copy.
        </p>
        {verification && received && received.length > 0 && (
          <p className={`verdict ${verification.ok ? 'ok' : 'error'}`} role="status">
            {verification.ok
              ? `${passed} of ${verification.observations.length} reports match the city's copy exactly, including their history.`
              : `${verification.observations.length - passed} of ${verification.observations.length} reports differ from the city's copy.`}
          </p>
        )}
      </header>
      {error && <p className="error" role="alert">{error}</p>}
      {received?.length === 0 && <p className="empty">Nothing has arrived yet. Review reports in the city view, then send them here.</p>}

      <ul className="received">
        {received?.map((o) => {
          const row = rowFor(o.id);
          const open = o.id === openId;
          return (
            <li key={o.id} className={`received-item${open ? ' is-open' : ''}`}>
              <button type="button" className="received-summary" aria-expanded={open} onClick={() => setOpenId(open ? null : o.id)}>
                <span className="received-q">{o.question}: <span className="hand-citizen">{o.value}</span></span>
                <span className="muted">{o.siteName ?? o.site}</span>
                <StateBadge state={o.reviewState} />
                {row && <span className={row.ok ? 'match ok' : 'match error'}>{row.ok ? 'Matches city copy' : 'Differs from city copy'}</span>}
              </button>
              {open && (
                <div className="received-body">
                  <EvidenceTrail steps={o.history} />
                  {row && (
                    <ul className="checks" aria-label="Comparison with the city's copy">
                      {Object.entries(row.checks).map(([k, v]) => (
                        <li key={k} className={v ? 'ok' : 'error'}>
                          <span aria-hidden="true">{v ? '✓' : '✗'}</span> {CHECK_LABEL[k as keyof VerificationRow['checks']]}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <HealthContext />
    </section>
  );
}
