/**
 * Dashboard — the call category pie.
 *
 * The bar list already ranks the categories, so the only thing the pie adds is
 * the share. That makes the denominator the whole test: a share of
 * the ten categories the list happens to carry is not a share of anything a
 * reader would recognise, so the cases below pin it to every categorised issue
 * and pin the tail past five wedges to a single `Other`.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

let isAdmin = true;

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'jwt', user: { name: 'Admin', role: 'admin' }, isAdmin }),
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

// Seven categories against a round hundred: the top five are 84 of it, so a
// percentage worked out against the listed rows rather than the whole would
// come out visibly wrong (40 of 84 is 48%, not 40%).
//
// Shaped as /api/calls/stats/summary returns it — `total` per category, not
// `count`, which is the one thing the wiring has to get right.
const CATEGORIES = [
  { category: 'Payment Gateway', total: 40, subs: [] },
  { category: 'Login Failure',   total: 20, subs: [] },
  { category: 'App Crash',       total: 10, subs: [] },
  { category: 'Refund Delay',    total: 8,  subs: [] },
  { category: 'Notification',    total: 6,  subs: [] },
  { category: 'Search Broken',   total: 4,  subs: [] },
  { category: 'Profile Update',  total: 2,  subs: [] },
];

let statsValue;

vi.mock('../hooks/useCalls', () => ({
  useStats: () => ({ stats: statsValue, refetch: () => {} }),
  useCalls: () => ({ calls: [], total: 0, loading: false, error: null, refetch: () => {} }),
  useDateRange: () => ({ minDate: '2026-01-01' }),
  useAgentMap: () => ({}),
  initiateCall: () => Promise.resolve({ status: 'Success' }),
  pollClick2Call: () => {},
}));

const { default: Dashboard } = await import('../pages/Dashboard');

const pie = () =>
  screen.getByText('Category Mix').closest('div').parentElement;

beforeEach(() => {
  isAdmin = true;
  statsValue = { categoryBreakdown: CATEGORIES, categoryTotal: 100 };
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200, json: async () => ({ tickets: [], total: 0 }),
  })));
});

describe('the category pie', () => {
  it('states each category as a share of every categorised issue', () => {
    render(<Dashboard />);
    const panel = within(pie());

    expect(panel.getByText('40%')).toBeInTheDocument();   // 40 of 100, not of 84
    expect(panel.getByText('20%')).toBeInTheDocument();
    expect(panel.getByText('10%')).toBeInTheDocument();
    expect(panel.getByText('8%')).toBeInTheDocument();
    expect(panel.getByText('6%')).toBeInTheDocument();
  });

  it('names the whole it is dividing', () => {
    render(<Dashboard />);
    expect(within(pie()).getByText('100 categorised issues')).toBeInTheDocument();
  });

  /**
   * Six wedges is the point past which adjacent slices stop being tellable
   * apart, so the tail is one grey residual rather than a sixth and seventh
   * identity.
   */
  it('folds everything past the top five into a single Other', () => {
    render(<Dashboard />);
    const panel = within(pie());

    expect(panel.queryByText('Search Broken')).not.toBeInTheDocument();
    expect(panel.queryByText('Profile Update')).not.toBeInTheDocument();
    // 100 − 84: the two rows above plus whatever never reached the top ten.
    expect(panel.getByText('Other')).toBeInTheDocument();
    expect(panel.getByText('16%')).toBeInTheDocument();
  });

  it('draws one wedge per share, each labelled for a pointer', () => {
    render(<Dashboard />);
    const svg = pie().querySelector('svg');

    const wedges = svg.querySelectorAll('path');
    expect(wedges).toHaveLength(6);
    expect(wedges[0].querySelector('title').textContent)
      .toBe('Payment Gateway — 40 (40%)');
  });

  it('reads out the hovered category against the whole', async () => {
    render(<Dashboard />);
    const panel = within(pie());

    await userEvent.hover(panel.getByText('Login Failure'));

    await waitFor(() =>
      expect(panel.getByText('Login Failure · 20 of 100')).toBeInTheDocument());
  });

  // A server that predates the panel sends no grand total. What is on screen is
  // then the only whole available, and the shares still have to add up.
  it('falls back to the listed counts when no total is sent', () => {
    statsValue = { categoryBreakdown: [{ category: 'Login Failure', total: 3 },
                                       { category: 'App Crash', total: 1 }] };
    render(<Dashboard />);
    const panel = within(pie());

    expect(panel.getByText('75%')).toBeInTheDocument();
    expect(panel.getByText('25%')).toBeInTheDocument();
    expect(panel.queryByText('Other')).not.toBeInTheDocument();
  });

  it('says so plainly when the AI has categorised nothing', () => {
    statsValue = { categoryBreakdown: [], categoryTotal: 0 };
    render(<Dashboard />);
    expect(within(pie()).getByText('No categories identified yet')).toBeInTheDocument();
  });

  /**
   * Calls and mail are categorised from ONE taxonomy, so a category that
   * arrived both ways is a single wedge carrying the sum. A pie showing only
   * one channel would understate every shared category and mislead about which
   * leads.
   */
  describe('across both channels', () => {
    const MAIL_STATS = {
      total: 12, replies: 2, unread: 1, read: 9, conversations: 5,
      topCategories: [
        { category: 'Payment Gateway', count: 10 },   // also a call category
        { category: 'Mailbox Only',    count: 15 },   // mail alone, big enough to earn a wedge
      ],
      categoryTotal: 29,
    };

    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn(async (url) => ({
        ok: true, status: 200,
        json: async () => String(url).includes('/api/emails/stats/summary')
          ? MAIL_STATS
          : { tickets: [], total: 0 },
      })));
    });

    it('adds a category that arrived by both phone and mail', async () => {
      render(<Dashboard />);
      const panel = within(pie());

      // 40 calls + 10 mails of 129 (100 + 29) — not 40 of 100, and not two
      // separate Payment Gateway wedges.
      await userEvent.hover(panel.getByText('Payment Gateway'));
      await waitFor(() =>
        expect(panel.getByText('Payment Gateway · 50 of 129')).toBeInTheDocument());
    });

    it('divides by both channels' + "'" + ' totals together', async () => {
      render(<Dashboard />);
      await waitFor(() =>
        expect(within(pie()).getByText(/129 categorised issues/)).toBeInTheDocument());
    });

    it('carries a category only one channel has', async () => {
      render(<Dashboard />);
      await waitFor(() =>
        expect(within(pie()).getByText('Mailbox Only')).toBeInTheDocument());
    });
  });

  // The list this pie divides is admin-only; the shares of it are no less so.
  it('is not shown to an agent', () => {
    isAdmin = false;
    render(<Dashboard />);
    expect(screen.queryByText('Category Mix')).not.toBeInTheDocument();
  });
});
