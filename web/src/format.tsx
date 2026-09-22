import type { ReviewState } from './api';

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDate(iso: string | null): string {
  if (!iso) return 'undated';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

export const STATE_LABEL: Record<ReviewState, string> = {
  unreviewed: 'Waiting for review',
  'auto-checked': 'Checked automatically, waiting for review',
  accepted: 'Accepted',
  rejected: 'Rejected',
  'needs-follow-up': 'Follow-up requested',
};

export function StateBadge({ state }: { state: ReviewState }) {
  return <span className={`state state-${state}`}>{STATE_LABEL[state]}</span>;
}
