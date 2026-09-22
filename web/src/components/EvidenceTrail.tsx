import type { HistoryStep } from '../api';
import { formatTime } from '../format';

const LABEL: Record<HistoryStep['activity'], string> = {
  capture: 'Report sent from the stream',
  'ai-code-suggestion': 'Answer suggested from the note, confirmed by the contributor',
  extraction: 'Turned into OAH observations',
  'automated-check': 'Automatic plausibility check',
  'expert-review': 'Reviewed by the city',
  'exchange-import': 'Received by the health authority',
};

function detail(step: HistoryStep): string | null {
  if (step.activity === 'capture' || step.activity === 'extraction') return null;
  return step.reason;
}

function who(step: HistoryStep): string {
  if (step.activity === 'capture') return 'Pseudonymous contributor';
  return step.by?.startsWith('urn:uuid:') ? 'Pseudonymous contributor' : (step.by ?? 'Unknown');
}

/**
 * The observation's history as one continuous line. Steps recorded after an exchange-import are drawn
 * past a boundary, so the line visibly flows from the city system into the receiving system.
 */
export function EvidenceTrail({ steps }: { steps: HistoryStep[] }) {
  if (!steps.length) return <p className="muted">No history recorded yet.</p>;
  return (
    <ol className="trail" aria-label="Evidence history">
      {steps.map((step) => {
        const flagged = step.activity === 'automated-check' && step.reason?.startsWith('FLAGGED');
        const text = detail(step)?.replace(/^(FLAGGED|OK): /, '');
        return (
          <li key={step.id} className={`trail-step trail-${step.activity}${flagged ? ' is-flagged' : ''}`}>
            {step.activity === 'exchange-import' && <span className="trail-boundary">City system → health authority system</span>}
            <span className="trail-node" aria-hidden="true" />
            <div className="trail-body">
              <p className="trail-title">
                {LABEL[step.activity]}
                {flagged && <span className="flag">Needs a look</span>}
              </p>
              {text && <p className="trail-detail">{text}</p>}
              {step.activity === 'automated-check' && step.sources.length > 0 && (
                <p className="trail-sources">
                  Compared with lab record{step.sources.length > 1 ? 's' : ''}{' '}
                  {step.sourceLabels.join(', ')}
                </p>
              )}
              <p className="trail-meta">{who(step)}, {formatTime(step.recorded)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
