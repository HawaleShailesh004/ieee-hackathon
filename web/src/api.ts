// Typed client for lane-service.

export type ReviewState = 'unreviewed' | 'auto-checked' | 'accepted' | 'rejected' | 'needs-follow-up';
export type Decision = 'accepted' | 'rejected' | 'needs-follow-up';

export interface Coding { system: string; code: string; display?: string }

export interface QItem {
  linkId: string;
  text: string;
  type: 'group' | 'choice' | 'quantity' | 'text' | string;
  code?: Coding[];
  item?: QItem[];
  answerOption?: { valueCoding: Coding }[];
}
export interface Questionnaire { url: string; version: string; title: string; item: QItem[] }

export interface Site {
  id: string; name: string; description: string | null;
  lab: number; citizen: number; stream: boolean;
}

export interface HistoryStep {
  id: string;
  activity: 'capture' | 'ai-code-suggestion' | 'extraction' | 'automated-check' | 'expert-review' | 'exchange-import';
  recorded: string;
  reason: string | null;
  by: string | null;
  agents: { role?: string; who?: string }[];
  sources: string[];
  /** Human-readable labels for sources, in the same order (e.g. "16.1 °C (2024-11)"). */
  sourceLabels: string[];
}

export interface CitizenObservation {
  id: string; site: string; siteName: string | null;
  code: string; question: string; value: string | null; effective: string;
  contributor: string; reviewState: ReviewState; history: HistoryStep[];
}

export interface LabSeries {
  code: string; name: string; unit: string | null;
  points: { id: string; date: string | null; value: number | null; text: string | null; performer: string | null }[];
}
export interface SiteDetail { id: string; name: string; description: string | null; lab: LabSeries[]; citizen: CitizenObservation[] }

export interface Suggestion { linkId: string; text: string; coding: Coding; quote: string }

export interface CheckResult { observation: string; question: string; value: string; flag: boolean; finding: string; evidence: string[] }
export interface SubmitResult { observations: string[]; checks: CheckResult[]; validated: number }

export interface VerificationRow {
  observation: string; code: string; reviewState: ReviewState; historySteps: number; ok: boolean;
  checks: Record<'sameValue' | 'sameReviewState' | 'stillCitizen' | 'samePseudonymousContributor' | 'historyIntact' | 'reviewTravelled' | 'importRecorded', boolean>;
}
export interface Verification { ok: boolean; observations: VerificationRow[] }
export interface ExchangeResult {
  moved: { observations: number; responses: number; locations: number; provenance: number };
  verification: Verification;
}

export interface Config { aiEnabled: boolean; aiModel: string | null; servers: { city: string; health: string } }

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  config: () => call<Config>('/config'),
  questionnaire: () => call<Questionnaire>('/questionnaire'),
  sites: () => call<Site[]>('/sites'),
  site: (id: string) => call<SiteDetail>(`/sites/${id}`),
  suggest: (note: string) => call<{ model: string; suggestions: Suggestion[] }>('/suggest', { method: 'POST', body: { note } }),
  submit: (body: { siteId: string; contributorId: string; items: unknown[]; note?: string; aiSuggestions?: Suggestion[] }) =>
    call<SubmitResult>('/assessments', { method: 'POST', body }),
  queue: () => call<CitizenObservation[]>('/review-queue'),
  review: (id: string, decision: Decision, reason: string) =>
    call<{ state: ReviewState }>(`/observations/${id}/review`, { method: 'POST', body: { decision, reason } }),
  exchange: (observationIds: string[]) => call<ExchangeResult>('/exchange', { method: 'POST', body: { observationIds } }),
  received: () => call<CitizenObservation[]>('/health/observations'),
  verify: () => call<Verification>('/health/verify'),
};

/** Stable pseudonymous id for this browser. No name, email or account is ever collected. */
export function contributorId(): string {
  const key = 'oah-contributor-id';
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = `urn:uuid:${crypto.randomUUID()}`;
    localStorage.setItem(key, id);
    return id;
  } catch {
    return `urn:uuid:${crypto.randomUUID()}`;
  }
}

export interface HealthContext {
  measures: number;
  places: {
    id: string; name: string; description: string | null; groups: number; years: string[];
    indicators: { code: string; name: string; unit: string; records: number; min: number; max: number }[];
  }[];
}
export const healthContext = () => call<HealthContext>('/health/context');

export interface MyReport {
  report: string; site: string; siteName: string | null; sent: string;
  answers: {
    id: string; question: string; value: string | null; reviewState: ReviewState; flagged: boolean;
    reviewReason: string | null; reviewedAt: string | null; sharedWithHealth: boolean;
  }[];
}
export const myReports = (contributor: string) =>
  call<MyReport[]>(`/my-reports?contributor=${encodeURIComponent(contributor)}`);
