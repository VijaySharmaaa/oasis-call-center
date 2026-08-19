/**
 * AI Analysis — two queues on one table.
 *
 * The page now lists verdicts formed from recordings and verdicts formed from
 * correspondence. What matters is that a mail row is legible as itself: marked
 * with where it came from, showing the sender and subject where a call shows a
 * number and a recording, and never offering a transcription that does not
 * exist.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'jwt', user: { name: 'Admin', role: 'admin' }, isAdmin: true }),
  AuthProvider: ({ children }) => children,
}));

vi.mock('../contexts/PageChromeContext', () => ({
  usePageChrome: () => ({
    dateFrom: '', dateTo: '',
    preset: 'all', setPreset: () => {},
    setDateFrom: () => {}, setDateTo: () => {},
    isFiltered: false,
    autoRefresh: false, setAutoRefresh: () => {},
    intervalMs: 10000, refreshedAt: null, refreshNow: () => {},
  }),
  usePageRefresh: () => {},
  PRESETS: [],
}));

vi.mock('../hooks/useCalls', () => ({
  useDateRange: () => ({ minDate: '2026-01-01' }),
  useAgentMap: () => ({ 1001: 'Ravi Kumar' }),
}));

const { default: AIAnalysis } = await import('../pages/AIAnalysis');

const CALL_ROW = {
  source: 'call',
  id: 'BZ-1',
  call_id: 'BZ-1',
  primary_category: 'Payment & Fee',
  call_category: 'Payment & Fee',
  ai_insight: 'Fee debited twice',
  bug_category: 'Payment Gateway',
  bugs: 'Gateway double charge',
  agent_score: 8,
  call_resolved: 'Yes',
  audio_quality: { rating: 'Good' },
  created_at: '2026-08-17T10:00:00Z',
  call: {
    call_id: 'BZ-1', caller_number: '919876543210', agent_number: '1001',
    duration: 252, call_recording: 'https://rec/BZ-1.wav',
    agent_answer_time: '2026-08-17 10:00:08', call_start_time: '2026-08-17 10:00:00',
  },
};

const EMAIL_ROW = {
  source: 'email',
  id: 'aasha@example.com',
  conversation_id: 'aasha@example.com',
  primary_category: 'Uploads & Documents',
  email_category: 'Uploads & Documents',
  ai_insight: 'Photo upload fails',
  bug_category: 'Document Upload',
  bugs: 'Upload rejects valid JPEG',
  requested_action: 'Fix',
  message_count: 3,
  created_at: '2026-08-16T10:00:00Z',
  email: {
    participant_email: 'aasha@example.com', participant_name: 'Aasha',
    last_subject: 'Photo upload keeps failing', message_count: 3,
    last_message_at: '2026-08-16T10:00:00Z',
  },
};

function stubFetch(analyses = [CALL_ROW, EMAIL_ROW]) {
  const fetchMock = vi.fn(async (url) => {
    const href = String(url);
    const body = href.includes('/api/analysis')
      ? {
          analyses, total: analyses.length,
          counts: { calls: 1, emails: 1 },
          categories: ['Duplicate Payment'],
          bugCategories: ['Payment Gateway', 'Document Upload'],
          callCategories: ['Payment & Fee', 'Uploads & Documents'],
        }
      : { tickets: [] };
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The querystring of the most recent list request. */
function lastQuery(fetchMock) {
  const call = [...fetchMock.mock.calls].reverse().find(([u]) => String(u).includes('/api/analysis?'));
  return new URL(String(call[0]), 'http://localhost').searchParams;
}

const rowFor = text => screen.getByText(text).closest('tr');

let fetchMock;
beforeEach(async () => {
  fetchMock = stubFetch();
  render(<AIAnalysis />);
  await waitFor(() => expect(screen.getByText('Fee debited twice')).toBeInTheDocument());
});

describe('a mail verdict on the table', () => {
  it('is marked as coming from the mailbox, and a call as coming from a recording', () => {
    expect(within(rowFor('Photo upload fails')).getByText('Email')).toBeInTheDocument();
    expect(within(rowFor('Fee debited twice')).getByText('Call')).toBeInTheDocument();
  });

  it('renders its category from the queue-neutral field', () => {
    expect(within(rowFor('Photo upload fails')).getByText('Uploads & Documents')).toBeInTheDocument();
  });

  it('carries its bug across, the same as a call does', () => {
    expect(within(rowFor('Photo upload fails')).getByText('Document Upload')).toBeInTheDocument();
    expect(screen.getByText('Upload rejects valid JPEG')).toBeInTheDocument();
  });

  it('shows the subject where a call shows its recording', () => {
    expect(within(rowFor('Photo upload fails')).getByText('Photo upload keeps failing')).toBeInTheDocument();
  });

  // A transcription is what a recording produced; mail was already text.
  it('offers no transcription button', () => {
    expect(within(rowFor('Photo upload fails')).queryByTitle('View Transcription')).not.toBeInTheDocument();
    expect(within(rowFor('Fee debited twice')).getByTitle('View Transcription')).toBeInTheDocument();
  });
});

describe('the source toggle', () => {
  it('reads both queues until told otherwise', () => {
    expect(lastQuery(fetchMock).get('source')).toBe('all');
  });

  it('narrows to one queue', async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Emails' }));
    await waitFor(() => expect(lastQuery(fetchMock).get('source')).toBe('emails'));

    await userEvent.click(screen.getByRole('button', { name: 'Calls' }));
    await waitFor(() => expect(lastQuery(fetchMock).get('source')).toBe('calls'));
  });

  it('names how many came from each queue', () => {
    expect(screen.getByText(/1 call · 1 email/)).toBeInTheDocument();
  });
});
