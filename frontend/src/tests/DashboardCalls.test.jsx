/**
 * Dashboard — the call half.
 *
 * The four numbers and the list behind them are one object: the icon that shows
 * the summary is the control that opens the detail. So the cases that matter
 * are that the summary reads correctly, that pressing the icon reveals the
 * calls, that a missed call is findable by colour rather than by reading the
 * status column, and that nothing is fetched for a list nobody has opened.
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
    dateFrom: '2026-08-17', dateTo: '2026-08-17',
    preset: 'today', setPreset: () => {},
    setDateFrom: () => {}, setDateTo: () => {},
    isFiltered: false,
    autoRefresh: false, setAutoRefresh: () => {},
    intervalMs: 5000, refreshedAt: null, refreshNow: () => {},
  }),
  usePageRefresh: () => {},
  PRESETS: [],
}));

const CALLS = [
  { id: 'c1', call_id: 'BZ-1', caller_number: '919876543210', called_number: '918037126236',
    agent_number: '1001', agent_answer_time: '2026-08-17 14:30:08',
    call_start_time: '2026-08-17 14:30:00', duration: 252 },
  { id: 'c2', call_id: 'BZ-2', caller_number: '919812345678', called_number: '918037126236',
    agent_number: '', agent_answer_time: '',
    call_start_time: '2026-08-17 12:00:00', duration: 20 },
];

const STATS = {
  total: 42, received: 30, missed: 12, avgDuration: 252, latestMissed: [],
  // As /api/calls/stats/summary returns it: `total` per category, not `count`.
  categoryBreakdown: [
    { category: 'Educational Qualifications', total: 18, subs: [] },
    { category: 'Payment & Fee', total: 7, subs: [] },
  ],
  // Every categorised issue, not just the two listed: the tail becomes "Other".
  categoryTotal: 40,
  topBugs: [{ category: 'Payment Gateway', count: 4 }],
  topBugsTotal: 4,
};

// useCalls is the hook the expandable list uses; a spy on it proves the list is
// not fetched until the icon is pressed.
const useCallsSpy = vi.fn(() => ({ calls: CALLS, total: CALLS.length, loading: false, error: null, refetch: () => {} }));

vi.mock('../hooks/useCalls', () => ({
  useStats: () => ({ stats: STATS, refetch: () => {} }),
  useCalls: (...args) => useCallsSpy(...args),
  useDateRange: () => ({ minDate: '2026-01-01' }),
  useAgentMap: () => ({ 1001: 'Ravi Kumar' }),
  initiateCall: () => Promise.resolve({ status: 'Success' }),
  pollClick2Call: () => {},
}));

const { default: Dashboard } = await import('../pages/Dashboard');

function stubFetch() {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ tickets: [], total: 0 }) }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const callHalf = () => screen.getByText('Calls', { selector: 'p' }).closest('div').parentElement;
const callTile = () => screen.getByRole('button', { name: /show the call list/i });

const onNavigate = vi.fn();

beforeEach(() => {
  useCallsSpy.mockClear();
  onNavigate.mockClear();
  stubFetch();
  render(<Dashboard onNavigate={onNavigate} />);
});

describe('the two halves', () => {
  it('gives the page one side for calls and one for mail', () => {
    expect(screen.getByText('Calls', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText('Mail', { selector: 'p' })).toBeInTheDocument();
  });
});

describe('the call tile', () => {
  it('summarises total, received, missed and average duration', async () => {
    const half = within(callHalf());
    for (const label of ['Total', 'Received', 'Missed', 'Avg Duration']) {
      expect(half.getByText(label)).toBeInTheDocument();
    }
    // AnimatedNumber counts up, so the settled values are what to wait for.
    await waitFor(() => expect(half.getByText('42')).toBeInTheDocument());
    expect(half.getByText('30')).toBeInTheDocument();
    expect(half.getByText('12')).toBeInTheDocument();
    expect(half.getByText('4m 12s')).toBeInTheDocument();   // 252 seconds
  });

  it('keeps the list closed until asked', () => {
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  // A hook that runs polls every few seconds. Mounting the panel only when it
  // is open is what stops the Dashboard fetching a list nobody opened.
  it('does not fetch the calls until the tile is pressed', async () => {
    expect(useCallsSpy).not.toHaveBeenCalled();

    await userEvent.click(callTile());

    await waitFor(() => expect(useCallsSpy).toHaveBeenCalled());
  });

  /**
   * The whole card is the control. Half a card that responds to a click teaches
   * people to hunt for the live part, so pressing the numbers themselves — not
   * only the icon — has to work.
   */
  it('opens from anywhere on the card, including the numbers', async () => {
    await userEvent.click(within(callHalf()).getByText('Avg Duration'));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  it('opens on Enter, so it is reachable by keyboard', async () => {
    callTile().focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });

  // Answering "which calls?" by leaving the page loses the range, the other
  // half, and the reason you asked.
  it('does not navigate away', async () => {
    await userEvent.click(callTile());
    await screen.findByRole('table');
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

/**
 * The mail half has always answered "what is this traffic about". The call half
 * had the same data — the stats endpoint returns categoryBreakdown — and simply
 * never drew it.
 */
describe('call categories', () => {
  it('breaks the calls down by category, like the mail half does', () => {
    const half = within(callHalf());
    expect(half.getByText('Call Categories')).toBeInTheDocument();
    expect(half.getByText('Educational Qualifications')).toBeInTheDocument();
    expect(half.getByText('Payment & Fee')).toBeInTheDocument();
  });

  it("reads the endpoint's `total` as the bar's count", async () => {
    // The two field names differ by endpoint; getting this wrong renders bars
    // of zero width and no numbers, which looks like "no data" rather than a bug.
    const half = within(callHalf());
    await waitFor(() => expect(half.getByText('18')).toBeInTheDocument());
    expect(half.getByText('7')).toBeInTheDocument();
  });

  it('says so plainly when nothing has been analysed', () => {
    // Both halves use the same component, so both give the same empty message.
    expect(screen.getAllByText('Nothing analysed yet').length).toBeGreaterThan(0);
  });
});

/**
 * The pie answers what the bar list cannot: whether the leading category is
 * most of the traffic or merely first among many. It was previously drawn from
 * the bug counts, which is a different question with a similar-sounding name.
 */
describe('the category mix pie', () => {
  it('is drawn from the categories, not the bug counts', async () => {
    expect(await screen.findByText('Category Mix')).toBeInTheDocument();

    const pie = screen.getByRole('img', { name: /share of AI-identified categories/i });
    expect(pie.getAttribute('aria-label')).toMatch(/Educational Qualifications/);
    expect(pie.getAttribute('aria-label')).not.toMatch(/Payment Gateway/);
  });

  it('divides by every categorised issue, so the tail shows as Other', () => {
    // 18 + 7 of 40 are listed; the remaining 15 must not vanish, or the shares
    // would describe an arbitrary top slice as though it were the whole.
    expect(screen.getByText(/40 categorised issues/)).toBeInTheDocument();
    const pie = screen.getByRole('img', { name: /share of AI-identified categories/i });
    expect(pie.getAttribute('aria-label')).toMatch(/Other/);
  });
});

describe('the call list, once opened', () => {
  beforeEach(async () => {
    await userEvent.click(callTile());
    await screen.findByRole('table');
  });

  it('shows a row per call with caller, receiver, time and duration', () => {
    const table = within(screen.getByRole('table'));
    for (const header of ['Caller', 'Receiver', 'Time', 'Duration', 'Status']) {
      expect(table.getByText(header)).toBeInTheDocument();
    }
    expect(table.getByText('919876543210')).toBeInTheDocument();
    expect(table.getByText('Ravi Kumar')).toBeInTheDocument();      // the agent who took it
    expect(table.getByText('4m 12s')).toBeInTheDocument();
  });

  /**
   * The reason this list exists on a dashboard: the missed ones are the
   * actionable rows, and they have to be findable in a long list without
   * reading a column.
   */
  it('marks a missed call in red', () => {
    const row = screen.getByText('919812345678').closest('tr');
    expect(row.className).toMatch(/bg-red-50/);
    expect(within(row).getByText('Missed')).toBeInTheDocument();
  });

  it('leaves an answered call unmarked', () => {
    const row = screen.getByText('919876543210').closest('tr');
    expect(row.className).not.toMatch(/bg-red-50/);
    expect(within(row).getByText('Received')).toBeInTheDocument();
  });

  it('falls back to the dialled number when nobody answered', () => {
    // A missed call has no agent, so the number that rang is all there is.
    const row = screen.getByText('919812345678').closest('tr');
    expect(within(row).getByText('918037126236')).toBeInTheDocument();
  });

  it('asks for the same window the header has selected', () => {
    expect(useCallsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: '2026-08-17', dateTo: '2026-08-17', token: 'jwt' })
    );
  });

  it('closes again', async () => {
    await userEvent.click(screen.getByRole('button', { name: /hide the call list/i }));
    await waitFor(() => expect(screen.queryByRole('table')).not.toBeInTheDocument());
  });
});
