import { useEffect, useState } from 'react';
import { healthContext, type HealthContext as Context } from '../api';

// "% of people with high blood sugar/diabetes" -> "People with high blood sugar/diabetes"
const plain = (name: string) => name.replace(/^% of /, '').replace(/^./, (c) => c.toUpperCase());
const range = (min: number, max: number, unit: string) =>
  min === max ? `${min}${unit === '%' ? '%' : ` ${unit}`}` : `${min}–${max}${unit === '%' ? '%' : ` ${unit}`}`;

/**
 * Population health measures this system already holds in the same OAH format. They are for other places
 * than the stream reports, so the panel says plainly that no link is implied.
 */
export function HealthContext() {
  const [data, setData] = useState<Context | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { healthContext().then(setData).catch((e) => setError(e.message)); }, []);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!data) return null;
  if (!data.places.length) return null;
  return (
    <section className="context" aria-labelledby="context-title">
      <h3 id="context-title">Population health data already in this system</h3>
      <p className="context-note">
        {data.measures} OAH health measures for {data.places.map((p) => p.name).join(' and ')}. They are
        different places from the stream reports above, and no link between them is implied. They are shown
        because citizen reports now arrive in the same OAH format, so both can be queried and analysed together.
      </p>
      <div className="context-places">
        {data.places.map((p) => (
          <div className="context-place" key={p.id}>
            <p className="context-place-name">{p.name}</p>
            <p className="muted">
              {p.description ? `${p.description}. ` : ''}{p.years.join(', ')}, {p.groups} population groups.
            </p>
            <table>
              <thead>
                <tr><th scope="col">Measure</th><th scope="col">Range across groups</th></tr>
              </thead>
              <tbody>
                {p.indicators.map((i) => (
                  <tr key={i.code}><td>{plain(i.name)}</td><td>{range(i.min, i.max, i.unit)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </section>
  );
}
