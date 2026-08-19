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

/** Open a dropdown by its current label and choose an option. */
async function choose(currentLabel, optionLabel) {
  await userEvent.click(screen.getByRole('button', { name: currentLabel }));
  const options = await screen.findAllByRole('button', { name: optionLabel });
  await userEvent.click(options[options.length - 1]);
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
    await choose('Any Reply State', 'Replied');
    await waitFor(() => expect(lastListQuery(fetchMock).get('replied')).toBe('true'));

    await choose('Replied', 'Not Replied');
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
    await choose('Any Analysis', label);
    await waitFor(() => expect(lastListQuery(fetchMock).get('analysisStatus')).toBe(value));
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
    await choose('Any Reply State', 'Replied');
    await choose('Any Analysis', 'Failed');

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));

    await waitFor(() => {
      const qs = lastListQuery(fetchMock);
      expect(qs.get('unread')).toBeNull();
      expect(qs.get('replied')).toBeNull();
      expect(qs.get('analysisStatus')).toBeNull();
    });
  });
});
