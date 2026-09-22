import { useEffect, useState } from 'react';
import { api, type Config } from './api';
import { CitizenView } from './components/CitizenView';
import { ReviewerView } from './components/ReviewerView';
import { HealthView } from './components/HealthView';

const VIEWS = [
  { id: 'report', label: 'Report a stream', who: 'Citizen' },
  { id: 'review', label: 'Review reports', who: 'City' },
  { id: 'health', label: 'Received evidence', who: 'Health authority' },
] as const;
type ViewId = (typeof VIEWS)[number]['id'];

const fromHash = (): ViewId => (VIEWS.find((v) => `#${v.id}` === window.location.hash)?.id ?? 'report');

export function App() {
  const [view, setView] = useState<ViewId>(fromHash);
  const [config, setConfig] = useState<Config | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [offline, setOffline] = useState<string | null>(null);

  useEffect(() => {
    const onHash = () => setView(fromHash());
    window.addEventListener('hashchange', onHash);
    api.config().then(setConfig).catch(() => setOffline('The app cannot reach its service. Start it with "npm start" in lane/, then reload.'));
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M3 9c6-5 10 5 16 0s10-2 10-2M3 17c6-5 10 5 16 0s10-2 10-2M3 25c6-5 10 5 16 0s10-2 10-2" />
          </svg>
          <div>
            <h1>Streams to Systems</h1>
            <p>Citizen stream reports that reach public health as evidence you can trace.</p>
          </div>
        </div>
        <nav className="views" aria-label="Views">
          {VIEWS.map((v) => (
            <a key={v.id} href={`#${v.id}`} className={`view-tab${view === v.id ? ' is-current' : ''}`} aria-current={view === v.id ? 'page' : undefined}>
              <span className="view-who">{v.who}</span>
              <span className="view-label">{v.label}</span>
            </a>
          ))}
        </nav>
      </header>

      <main>
        {offline && <p className="error" role="alert">{offline}</p>}
        {view === 'report' && <CitizenView config={config} onSubmitted={bump} />}
        {view === 'review' && <ReviewerView refreshKey={refreshKey} onExchanged={bump} />}
        {view === 'health' && <HealthView refreshKey={refreshKey} />}
      </main>

      <footer className="colophon">
        <p>
          Records are HL7 FHIR R4, validated against the OneAquaHealth FHIR Implementation Guide plus a citizen-science extension.
          Lab data shown is the IG's published example data. A OneAquaHealth IEEE Hackathon 2026 prototype, not an official
          OneAquaHealth tool.
        </p>
        {config && <p className="muted">City server {config.servers.city}. Health server {config.servers.health}.{config.aiEnabled ? ` Note suggestions by ${config.aiModel}.` : ''}</p>}
      </footer>
    </div>
  );
}
