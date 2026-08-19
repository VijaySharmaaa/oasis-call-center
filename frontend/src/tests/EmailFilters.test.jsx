/**
 * Emails tab — the triage filters.
 *
 * These assert the question the page asks the API, not what the API answers:
 * a filter that renders beautifully and sends the wrong querystring is a filter
 * that silently lies about what is on screen.
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
    intervalMs: 15000, refreshedAt: null, refreshNow: () => {},
  }),
  usePageRefresh: () => {},
  PRESETS: [],
}));

vi.mock('../hooks/useCalls', () => ({ useDateRange: () => ({ minDate: '2026-01-01' }) }));

const { default: Emails } = await import('../pages/Emails');

const CONVERSATION = {
  id: 'aasha@example.com',
  participant_email: 'aasha@example.com',
  participant_name: 'Aasha',
  last_subject: 'Fee debited twice',
  last_message_at: '2026-08-16T10:00:00Z',
  unread_count: 1,
  message_count: 1,
  category: 'Payment & Fee',
  awaiting_analysis: false,
  queue_status: 'completed',
};

function stubFetch() {
  const fetchMock = vi.fn(async (url) => {
    const href = String(url);
    let body = {};
    if (href.includes('/conversations?')) {
      body = { conversations: [CONVERSATION], total: 1, unreadCount: 1 };
    } else if (href.includes('/categories')) {
      body = { schema: [{ name: 'Payment & Fee', sub_categories: [] }] };
    } else if (href.includes('/sync-status')) {
      body = { configured: true, mailbox: 'support@upessc.org' };
    } else if (href.includes('/analysis/stats')) {
      body = { queue: {}, coverage: {} };
    }
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The querystring of the most recent conversations request. */
function lastListQuery(fetchMock) {
  const call = [...fetchMock.mock.calls].reverse().find(([u]) => String(u).includes('/conversations?'));
  return new URL(String(call[0]), 'http://localhost').searchParams;
}

/**
 * Set a filter the way an operator now has to: open the ⋯ menu, say WHICH
 * filter, then pick the value. Two steps rather than one, which is the whole
 * trade the compact bar makes.
 */
async function choose(filterName, optionLabel) {
  await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: new RegExp(`^${filterName}`) }));
  await userEvent.click(await screen.findByRole('menuitem', { name: optionLabel }));
}

let fetchMock;
beforeEach(async () => {
  fetchMock = stubFetch();
  render(<Emails />);
  // The page renders the desktop table and the mobile cards at once, toggled by
  // CSS, so every row value appears twice in the DOM.
  await waitFor(() => expect(screen.getAllByText('Aasha').length).toBeGreaterThan(0));
});

describe('read state', () => {
  it('is a pill row, the way the Call Report presents its primary status', () => {
    const tabs = screen.getByRole('button', { name: 'Unread' }).parentElement;
    for (const label of ['All', 'Unread', 'Read']) {
      expect(within(tabs).getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('asks for unread, then for read', async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Unread' }));
    await waitFor(() => expect(lastListQuery(fetchMock).get('unread')).toBe('true'));

    await userEvent.click(screen.getByRole('button', { name: 'Read' }));
    await waitFor(() => expect(lastListQuery(fetchMock).get('unread')).toBe('false'));
  });

  it('drops the filter entirely on All, rather than sending an empty one', async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Unread' }));
    await waitFor(() => expect(lastListQuery(fetchMock).get('unread')).toBe('true'));

    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(lastListQuery(fetchMock).get('unread')).toBeNull());
  });
});

describe('reply state', () => {
  it('asks whether anyone has written back', async () => {
    await choose('Reply State', 'Replied');
    await waitFor(() => expect(lastListQuery(fetchMock).get('replied')).toBe('true'));

    await choose('Reply State', 'Not Replied');
    await waitFor(() => expect(lastListQuery(fetchMock).get('replied')).toBe('false'));
  });
});

describe('analysis state', () => {
  // Every value the dropdown offers has to reach the API under the name the
  // backend filter knows it by, or the option is decorative.
  it.each([
    ['Analysed',     'analysed'],
    ['Not Analysed', 'unanalysed'],
    ['Awaiting',     'awaiting'],
    ['Queued',       'queued'],
    ['Analysing',    'processing'],
    ['Failed',       'failed'],
  ])('sends %s as analysisStatus=%s', async (label, value) => {
    await choose('Analysis', label);
    await waitFor(() => expect(lastListQuery(fetchMock).get('analysisStatus')).toBe(value));
  });
});

describe('the compact filter menu', () => {
  const openMenu = () => userEvent.click(screen.getByRole('button', { name: 'Filters' }));

  it('costs one button rather than a control per dimension', async () => {
    // The four dropdowns used to sit in the bar announcing that they were set
    // to nothing. Their options exist only once somebody asks for them.
    expect(screen.queryByText('Any Reply State')).not.toBeInTheDocument();
    expect(screen.queryByText('Any Analysis')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();

    await openMenu();
    for (const name of ['Reply State', 'Analysis', 'Content', 'Category']) {
      expect(await screen.findByRole('menuitem', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
  });

  it('shows a filter’s own options only after that filter is picked', async () => {
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Replied' })).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole('menuitem', { name: /^Reply State/ }));

    expect(await screen.findByRole('menuitem', { name: 'Replied' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Not Replied' })).toBeInTheDocument();
  });

  it('goes back to the list of filters without applying anything', async () => {
    await openMenu();
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Reply State/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Reply State' }));

    expect(await screen.findByRole('menuitem', { name: /^Analysis/ })).toBeInTheDocument();
    await waitFor(() => expect(lastListQuery(fetchMock).get('replied')).toBeNull());
  });

  /**
   * The one thing a compact bar must not do. A filter folded behind a button is
   * a filter you forget you set, and then the table is quietly lying about how
   * much mail there is — so what IS set stays on screen.
   */
  it('brings a set filter back out as a chip', async () => {
    await choose('Reply State', 'Replied');

    const chip = await screen.findByRole('button', { name: 'Replied' });
    expect(chip).toHaveAttribute('title', expect.stringContaining('Reply State'));
  });

  it('clears that one filter from its chip, leaving the others alone', async () => {
    await choose('Reply State', 'Replied');
    await choose('Analysis', 'Failed');
    await waitFor(() => expect(lastListQuery(fetchMock).get('replied')).toBe('true'));

    await userEvent.click(await screen.findByRole('button', { name: 'Replied' }));

    await waitFor(() => {
      const qs = lastListQuery(fetchMock);
      expect(qs.get('replied')).toBeNull();
      expect(qs.get('analysisStatus')).toBe('failed');   // untouched
    });
  });

  it('remembers what is set when the menu is reopened', async () => {
    await choose('Analysis', 'Failed');
    await openMenu();

    // The row for a set filter says so, so the menu doubles as the answer to
    // "what is narrowing this list right now".
    expect(await screen.findByRole('menuitem', { name: 'Analysis: Failed' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Reply State: Any' })).toBeInTheDocument();
  });

  it('shuts on Escape', async () => {
    await openMenu();
    expect(await screen.findByRole('menuitem', { name: /^Analysis/ })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('menuitem', { name: /^Analysis/ })).not.toBeInTheDocument());
  });
});

describe('clearing', () => {
  it('offers a way out only once something is filtered', async () => {
    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Unread' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument());
  });

  it('drops every filter the page owns in one go', async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Unread' }));
    await choose('Reply State', 'Replied');
    await choose('Analysis', 'Failed');

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    await waitFor(() => {
      const qs = lastListQuery(fetchMock);
      expect(qs.get('unread')).toBeNull();
      expect(qs.get('replied')).toBeNull();
      expect(qs.get('analysisStatus')).toBeNull();
    });
  });
});
