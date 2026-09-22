import type { LabSeries } from '../api';
import { formatDate } from '../format';

/** Small line of the site's lab readings for one indicator, with the citizen's value marked in ochre. */
function Strip({ series, citizenValue }: { series: LabSeries; citizenValue?: number }) {
  const pts = series.points.filter((p) => typeof p.value === 'number') as { value: number; date: string | null; id: string }[];
  if (!pts.length) return null;
  const values = [...pts.map((p) => p.value), ...(citizenValue !== undefined ? [citizenValue] : [])];
  const [min, max] = [Math.min(...values), Math.max(...values)];
  const span = max - min || 1;
  const W = 280, H = 64, pad = 14;
  const unit = series.unit === 'Celsius' ? '°C' : (series.unit ?? '');
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(pts.length - (citizenValue !== undefined ? 0 : 1), 1);
  const y = (v: number) => H - pad - ((v - min) / span) * (H - 2 * pad);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return (
    <svg className="strip" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`${series.name}: ${pts.length} lab readings from ${pts[0].value} to ${pts[pts.length - 1].value} ${series.unit ?? ''}${citizenValue !== undefined ? `; citizen reported ${citizenValue}` : ''}`}>
      <path d={path} className="strip-lab" />
      {pts.map((p, i) => <circle key={p.id} cx={x(i)} cy={y(p.value)} r={3} className="strip-lab-dot" />)}
      <text x={x(0)} y={y(pts[0].value) - 7} className="strip-label strip-label-lab">{pts[0].value} {unit}</text>
      {citizenValue !== undefined && (
        <>
          <circle cx={x(pts.length)} cy={y(citizenValue)} r={5} className="strip-citizen-dot" />
          <text x={x(pts.length) - 8} y={y(citizenValue) + 4} textAnchor="end" className="strip-label strip-label-citizen">{citizenValue} {unit}</text>
        </>
      )}
    </svg>
  );
}

export function LabContext({ series, focusCode, citizenValue }: { series: LabSeries[]; focusCode?: string; citizenValue?: number }) {
  if (!series.length) return <p className="muted">No lab records exist for this site.</p>;
  const focus = series.find((s) => s.code === focusCode);
  const total = series.reduce((n, s) => n + s.points.length, 0);
  const dates = series.flatMap((s) => s.points.map((p) => p.date)).filter(Boolean).sort() as string[];
  return (
    <div className="lab-context">
      <p className="lab-summary">
        <span className="hand-lab">{total} lab records</span> for this site across {series.length} indicators,
        {' '}{formatDate(dates[0])} to {formatDate(dates[dates.length - 1])}.
      </p>
      {focus ? (
        <div className="lab-focus">
          <p><strong>{focus.name}</strong>: {focus.points.length} lab reading{focus.points.length > 1 ? 's' : ''}
            {' '}({focus.points.map((p) => `${p.value ?? p.text} ${focus.unit ?? ''}`.trim()).join(', ')})</p>
          <Strip series={focus} citizenValue={citizenValue} />
          <p className="legend"><span className="key key-lab" /> Lab <span className="key key-citizen" /> This citizen report</p>
        </div>
      ) : (
        <p className="muted">The lab has no readings for this indicator here, so only a person can judge it.</p>
      )}
    </div>
  );
}
