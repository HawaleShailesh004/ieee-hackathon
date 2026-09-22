import { useEffect, useState } from 'react';
import { contributorId, myReports, type MyReport } from '../api';
import { formatTime } from '../format';

type Answer = MyReport['answers'][number];

/** What happened to an answer, in the contributor's terms. */
function outcome(a: Answer): { tone: string; text: string } {
  switch (a.reviewState) {
    case 'accepted':
      return { tone: 'accepted', text: 'Accepted by the city as evidence for this stream.' };
    case 'needs-follow-up':
      return { tone: 'follow-up', text: 'The city will follow this up.' };
    case 'rejected':
      return { tone: 'rejected', text: 'Not used by the city. It stays on record.' };
    default:
      return {
        tone: 'waiting',
        text: a.flagged ? 'Waiting for the city. It looked unusual, so it is near the top of the list.' : 'Waiting for the city to review it.',
      };
  }
}

export function MyReports({ onNewReport }: { onNewReport: () => void }) {
  const [reports, setReports] = useState<MyReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { myReports(contributorId()).then(setReports).catch((e) => setError(e.message)); }, []);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!reports) return <p className="muted">Loading your reports…</p>;
  if (!reports.length) {
    return (
      <div className="empty">
        <p>You haven't sent a report from this device yet.</p>
        <button type="button" className="button" onClick={onNewReport}>Report a stream</button>
      </div>
    );
  }

  const answers = reports.flatMap((r) => r.answers);
  const reviewed = answers.filter((a) => a.reviewState !== 'auto-checked' && a.reviewState !== 'unreviewed').length;
  const shared = answers.filter((a) => a.sharedWithHealth).length;

  return (
    <div className="my-reports">
      <p className="lede">
        {reports.length} visit{reports.length > 1 ? 's' : ''}, {answers.length} answers. The city has reviewed {reviewed},
        {' '}and {shared} {shared === 1 ? 'has' : 'have'} been shared with the regional health authority.
      </p>
      {reports.map((r) => (
        <article className="visit" key={r.report}>
          <h3>{r.siteName ?? r.site}</h3>
          <p className="muted">Sent {formatTime(r.sent)}</p>
          <ul className="visit-answers">
            {r.answers.map((a) => {
              const o = outcome(a);
              return (
                <li key={a.id} className={`visit-answer tone-${o.tone}`}>
                  <p className="visit-q">{a.question} <span className="hand-citizen">{a.value}</span></p>
                  <p className="visit-outcome">{o.text}</p>
                  {a.reviewReason && <p className="visit-reason">The city's note: “{a.reviewReason}”</p>}
                  {a.sharedWithHealth && <p className="visit-shared">Shared with the regional health authority, with its full history.</p>}
                </li>
              );
            })}
          </ul>
        </article>
      ))}
      <p className="muted">
        Reports are linked to this device by an anonymous code, not your name. Clearing this browser's data starts a new code.
      </p>
    </div>
  );
}
