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
import userEvent from '@testing-library/user-event';
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
  useCalls: () => ({ calls: [], total: 0, loading: false, error: null, refetch: () => {} }),
  useDateRange: () => ({ minDate: '2026-01-01' }),
  useAgentMap: () => ({}),
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

/** What the conversations endpoint returns for the expandable mail list. */
const CONVERSATIONS = [
  { id: 'aasha@example.com', participant_name: 'Aasha', participant_email: 'aasha@example.com',
    last_subject: 'Fee debited twice', last_message_at: '2026-08-16T10:00:00Z',
    message_count: 3, unread_count: 3 },
  { id: 'ravi@example.com', participant_name: 'Ravi', participant_email: 'ravi@example.com',
    last_subject: 'OTR edit query', last_message_at: '2026-08-15T10:00:00Z',
    message_count: 1, unread_count: 0 },
];

/** Routes every call the Dashboard makes; only the mailbox one carries data. */
function stubDashboardFetch(emailStats = EMAIL_STATS) {
  const fetchMock = vi.fn(async (url) => {
    const href = String(url);
    let body = { tickets: [], total: 0 };
    if (href.includes('/api/emails/stats/summary')) body = emailStats;
    else if (href.includes('/api/emails/conversations')) body = { conversations: CONVERSATIONS, total: CONVERSATIONS.length };
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

const mailbox = () =>
  screen.getByText('Mail', { selector: 'p' }).closest('div').parentElement;

beforeEach(() => { range = { dateFrom: '', dateTo: '' }; });

describe('the mailbox counters', () => {
  it('shows total, replies, unread and read', async () => {
    stubDashboardFetch();
    render(<Dashboard />);

    await waitFor(() => expect(within(mailbox()).getByText('Replies')).toBeInTheDocument());
    const panel = within(mailbox());
    for (const label of ['Total', 'Replies', 'Unread', 'Read']) {
      expect(panel.getByText(label)).toBeInTheDocument();
    }
    // Counted up by AnimatedNumber, so the final value is what to wait for.
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
  it('breaks the mailbox down by category', async () => {
    stubDashboardFetch();
    render(<Dashboard />);

    // Scoped: the Category Mix pie below the split now merges both channels,
    // so a mail category also appears there.
    await waitFor(() =>
      expect(within(mailbox()).getByText('Payment & Fee')).toBeInTheDocument());
    expect(within(mailbox()).getByText('Uploads & Documents')).toBeInTheDocument();
  });

  it('says nothing is analysed rather than showing an empty box', async () => {
    stubDashboardFetch({ ...EMAIL_STATS, topCategories: [] });
    render(<Dashboard />);

    // Scoped: both halves draw their categories with the same component, so
    // this message appears on the call side too.
    await waitFor(() =>
      expect(within(mailbox()).getByText('Nothing analysed yet')).toBeInTheDocument());
  });
});

/**
 * The mail tile behaves exactly as the call tile does: the whole card is the
 * control, and it opens the senders in place rather than leaving for the Emails
 * tab. Going to another page to answer "which senders?" loses the range, the
 * other half, and the reason you asked.
 */
describe('the mail list', () => {
  const mailTile = () => screen.getByRole('button', { name: /show the mail list/i });

  it('stays closed until the tile is pressed', async () => {
    stubDashboardFetch();
    render(<Dashboard />);

    await waitFor(() => expect(mailTile()).toBeInTheDocument());
    expect(screen.queryByText('Latest Subject')).not.toBeInTheDocument();
  });

  it('opens the senders in place, without navigating', async () => {
    const onNavigate = vi.fn();
    stubDashboardFetch();
    render(<Dashboard onNavigate={onNavigate} />);

    await userEvent.click(await screen.findByRole('button', { name: /show the mail list/i }));

    await waitFor(() => expect(screen.getByText('Latest Subject')).toBeInTheDocument());
    expect(screen.getByText('Aasha')).toBeInTheDocument();
    expect(screen.getByText('Fee debited twice')).toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('tints an unread sender, the same colour the tile gives the figure', async () => {
    stubDashboardFetch();
    render(<Dashboard />);

    await userEvent.click(await screen.findByRole('button', { name: /show the mail list/i }));

    const row = (await screen.findByText('Aasha')).closest('tr');
    expect(row.className).toMatch(/bg-amber-50/);
    expect(within(row).getByText('3 unread')).toBeInTheDocument();
  });

  it('closes again', async () => {
    stubDashboardFetch();
    render(<Dashboard />);

    await userEvent.click(await screen.findByRole('button', { name: /show the mail list/i }));
    await screen.findByText('Latest Subject');

    await userEvent.click(screen.getByRole('button', { name: /hide the mail list/i }));
    await waitFor(() => expect(screen.queryByText('Latest Subject')).not.toBeInTheDocument());
  });
});
