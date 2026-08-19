/**
 * Dashboard — the mailbox half.
 *
 * The Dashboard is one screen describing one window of time, so what matters
 * here is that the email counters arrive on screen, that they are asked for
 * over the SAME range the call stats use, and that the panels below them render
 * what the endpoint returned.
 *
 * Everything the call half needs (useStats, the page chrome, auth) is stubbed;
 * these tests are about the email data path, not about re-testing those.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'jwt', user: { name: 'Admin', role: 'admin' }, isAdmin: true }),
  AuthProvider: ({ children }) => children,
}));

// The header owns the date range; the Dashboard only reads it.
let range = { dateFrom: '', dateTo: '' };
vi.mock('../contexts/PageChromeContext', () => ({
  usePageChrome: () => ({
    ...range,
    preset: 'all', setPreset: () => {},
    setDateFrom: () => {}, setDateTo: () => {},
    isFiltered: false,
    autoRefresh: false, setAutoRefresh: () => {},
    intervalMs: 5000, refreshedAt: null, refreshNow: () => {},
  }),
  usePageRefresh: () => {},
  PRESETS: [],
}));

vi.mock('../hooks/useCalls', () => ({
  useStats: () => ({ stats: { total: 0, received: 0, missed: 0 }, refetch: () => {} }),
  useDateRange: () => ({ minDate: '2026-01-01' }),
  initiateCall: () => Promise.resolve({ status: 'Success' }),
  pollClick2Call: () => {},
}));

const { default: Dashboard } = await import('../pages/Dashboard');

const EMAIL_STATS = {
  total: 42,
  replies: 12,
  inbound: 30,
  unread: 7,
  read: 23,
  conversations: 9,
  awaitingAnalysis: 4,
  topCategories: [
    { category: 'Payment & Fee', count: 5 },
    { category: 'Uploads & Documents', count: 2 },
  ],
  latestUnread: [
    { id: 'aasha@example.com', participant_name: 'Aasha', participant_email: 'aasha@example.com',
      last_subject: 'Fee debited twice', last_message_at: '2026-08-16T10:00:00Z', unread_count: 3 },
  ],
};

/** Routes every call the Dashboard makes; only the mailbox one carries data. */
function stubDashboardFetch(emailStats = EMAIL_STATS) {
  const fetchMock = vi.fn(async (url) => {
    const href = String(url);
    const body = href.includes('/api/emails/stats/summary') ? emailStats : { tickets: [], total: 0 };
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The querystring of the mailbox request the Dashboard sent. */
function mailboxQuery(fetchMock) {
  const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/stats/summary'));
  return new URL(String(call[0]), 'http://localhost').searchParams;
}

const mailbox = () => screen.getByText('Mailbox').closest('div').parentElement;

beforeEach(() => { range = { dateFrom: '', dateTo: '' }; });

describe('the mailbox counters', () => {
  it('shows total, replies, unread and read', async () => {
    stubDashboardFetch();
    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText('Total Emails')).toBeInTheDocument());
    for (const label of ['Total Emails', 'Replies', 'Unread', 'Read']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Counted up by AnimatedNumber, so the final value is what to wait for.
    const panel = within(mailbox());
    await waitFor(() => expect(panel.getByText('42')).toBeInTheDocument());
    expect(panel.getByText('12')).toBeInTheDocument();
    expect(panel.getByText('7')).toBeInTheDocument();
    expect(panel.getByText('23')).toBeInTheDocument();
  });

  it('names the sender count and the analysis backlog under the cards', async () => {
    stubDashboardFetch();
    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText(/9 sender/)).toBeInTheDocument());
    expect(screen.getByText(/4 awaiting AI analysis/)).toBeInTheDocument();
  });

  it('says so plainly when the range holds no mail', async () => {
    stubDashboardFetch({ ...EMAIL_STATS, total: 0, replies: 0, unread: 0, read: 0, conversations: 0 });
    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText('No mail in this range')).toBeInTheDocument());
  });
});

describe('the range the counters are asked for', () => {
  it('sends no bounds when the header has none', async () => {
    const fetchMock = stubDashboardFetch();
    render(<Dashboard />);

    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/stats/summary'))).toBe(true));
    const qs = mailboxQuery(fetchMock);
    expect(qs.get('dateFrom')).toBeNull();
    expect(qs.get('dateTo')).toBeNull();
  });

  // The whole point of putting both halves on one screen: they describe the
  // same window, so a narrowed range has to reach the mailbox request too.
  it('forwards the header range, whole days included', async () => {
    range = { dateFrom: '2026-08-16', dateTo: '2026-08-17' };
    const fetchMock = stubDashboardFetch();
    render(<Dashboard />);

    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/stats/summary'))).toBe(true));
    const qs = mailboxQuery(fetchMock);
    expect(qs.get('dateFrom')).toBe('2026-08-16T00:00');
    expect(qs.get('dateTo')).toBe('2026-08-17T23:59');
  });
});

describe('the mailbox panels', () => {
  it('lists who is still waiting, with how many messages', async () => {
    stubDashboardFetch();
    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText('Aasha')).toBeInTheDocument());
    expect(screen.getByText('Fee debited twice')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('breaks the mailbox down by category', async () => {
    stubDashboardFetch();
    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText('Payment & Fee')).toBeInTheDocument());
    expect(screen.getByText('Uploads & Documents')).toBeInTheDocument();
  });

  it('says nothing is unread rather than showing an empty box', async () => {
    stubDashboardFetch({ ...EMAIL_STATS, latestUnread: [], topCategories: [] });
    render(<Dashboard />);

    await waitFor(() => expect(screen.getByText('Nothing unread')).toBeInTheDocument());
    expect(screen.getByText('Nothing analysed yet')).toBeInTheDocument();
  });
});
