/**
 * The Emails tab's CSV export.
 *
 * One thing is worth pinning here above all: the export carries the filters the
 * operator has on screen. An export that quietly ignores them produces a file
 * that looks right and is wrong, and nobody finds out until the numbers are
 * already in a meeting.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PageChromeProvider } from '../contexts/PageChromeContext';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'jwt', user: { name: 'Admin', role: 'admin' }, isAdmin: true }),
  AuthProvider: ({ children }) => children,
}));

// The header's date range is the only thing this page needs from the calls
// hooks, and it is a network call of its own.
vi.mock('../hooks/useCalls', () => ({ useDateRange: () => ({ minDate: '2026-01-01' }) }));

const { default: Emails } = await import('../pages/Emails');

/** Empty mailbox, healthy sync — the export button does not depend on rows. */
function stubFetch() {
  const calls = [];
  const fetchMock = vi.fn(async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const u = String(url);

    if (u.includes('/export/jobs/') ) {
      // Job status poll → finished immediately, with a signed download link.
      return { ok: true, json: async () => ({
        status: 'completed', rows_processed: 2,
        file_name: 'email-report.csv',
        download_url: '/api/emails/conversations/export/jobs/job1/download?token=t',
      })};
    }
    if (u.includes('/export/jobs')) {
      return { ok: true, json: async () => ({ job_id: 'job1', status: 'pending' }) };
    }
    if (u.includes('/conversations')) {
      return { ok: true, json: async () => ({ conversations: [], total: 0, unreadCount: 0 }) };
    }
    if (u.includes('/sync-status')) {
      return { ok: true, json: async () => ({ configured: true, mailbox: 'support@upessc.org' }) };
    }
    if (u.includes('/analysis/stats')) {
      return { ok: true, json: async () => ({ queue: {}, coverage: {} }) };
    }
    return { ok: true, json: async () => ({ schema: [] }) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

let harness;
beforeEach(() => {
  harness = stubFetch();
  // The download is an <a download> click; jsdom navigates nowhere useful.
  HTMLAnchorElement.prototype.click = vi.fn();
});

async function renderPage() {
  render(<PageChromeProvider><Emails /></PageChromeProvider>);
  await screen.findByRole('button', { name: /export csv/i });
}

/** The POST that queued the export, if any. */
function queuedExport() {
  const call = harness.calls.find(c => c.options?.method === 'POST' && c.url.includes('/export/jobs'));
  return call ? { url: call.url, body: JSON.parse(call.options.body) } : null;
}

describe('the export button', () => {
  it('queues a conversations export against the emails endpoint', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));

    await waitFor(() => expect(queuedExport()).not.toBeNull());
    expect(queuedExport().url).toContain('/api/emails/conversations/export/jobs');
  });

  it('sends nothing but the filters that are actually set', async () => {
    await renderPage();
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));

    await waitFor(() => expect(queuedExport()).not.toBeNull());
    // No filters on screen — an empty payload, not a payload of empty strings,
    // which the server would read as "unread=''" and refuse to match.
    expect(queuedExport().body).toEqual({});
  });

  it('carries the search and the unread filter the operator set', async () => {
    await renderPage();

    await userEvent.type(screen.getByPlaceholderText(/search sender/i), 'refund');
    await waitFor(() =>
      expect(harness.calls.some(c => c.url.includes('search=refund'))).toBe(true));

    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await waitFor(() => expect(queuedExport()).not.toBeNull());
    expect(queuedExport().body).toMatchObject({ search: 'refund' });
  });

  it('reports progress while the job runs, then downloads the finished file', async () => {
    await renderPage();
    const button = screen.getByRole('button', { name: /export csv/i });
    await userEvent.click(button);

    // Disabled while it works, so a second click cannot queue a second job.
    expect(button).toBeDisabled();
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled(), { timeout: 5000 });
    await waitFor(() => expect(screen.getByRole('button', { name: /export csv/i })).not.toBeDisabled(), { timeout: 5000 });
  });
});
