/**
 * The Category column on the Emails list.
 *
 * Two things share this cell: what the AI decided the chain is about, and
 * whether that decision is current. The verdict used to be a full "Analysed"
 * badge, which in a list where nearly every row is analysed became a column of
 * identical stickers standing between the reader and the categories. It is a
 * tick now, and the width it gave back carries each tag's sub-category — which
 * is why the separate Sub-category column is gone.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PageChromeProvider } from '../contexts/PageChromeContext';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'jwt', user: { name: 'Admin', role: 'admin' }, isAdmin: true }),
  AuthProvider: ({ children }) => children,
}));
vi.mock('../hooks/useCalls', () => ({ useDateRange: () => ({ minDate: '2026-01-01' }) }));
vi.mock('../components/EmailConversationModal', () => ({ default: () => null }));

const { default: Emails } = await import('../pages/Emails');

/** Analysed, and the verdict covers the newest message. */
const ANALYSED = {
  id: 'aasha@example.com',
  participant_email: 'aasha@example.com',
  participant_name: 'Km Aasha',
  last_subject: 'Payment reference',
  last_message_at: '2026-08-18T09:00:00.000Z',
  message_count: 3,
  unread_count: 0,
  category: 'Payment & Fee',
  sub_category: 'Duplicate Payment Refund Query',
  tags: [{ category: 'Payment & Fee', sub_category: 'Duplicate Payment Refund Query' }],
  analysed_at: '2026-08-18T09:05:00.000Z',
  awaiting_analysis: false,
  queue_status: 'completed',
};

/** Never read: the row an operator can actually act on. */
const AWAITING = {
  id: 'ravi@example.com',
  participant_email: 'ravi@example.com',
  participant_name: 'Ravi Sharma',
  last_subject: 'OTR edit query',
  last_message_at: '2026-08-15T10:00:00.000Z',
  message_count: 1,
  unread_count: 0,
  awaiting_analysis: true,
  queue_status: null,
};

let listPayload;

beforeEach(() => {
  listPayload = { conversations: [ANALYSED], total: 1, unreadCount: 0 };
  vi.stubGlobal('fetch', vi.fn(async url => {
    const u = String(url);
    if (u.includes('/conversations')) return { ok: true, json: async () => listPayload };
    if (u.includes('/sync-status')) return { ok: true, json: async () => ({ configured: true, can_send: true }) };
    if (u.includes('/analysis/stats')) return { ok: true, json: async () => ({ queue: {}, coverage: {} }) };
    return { ok: true, json: async () => ({ schema: [] }) };
  }));
});

/**
 * The page renders the desktop table AND the mobile cards, so every row is in
 * the DOM twice — CSS hides one, jsdom does not. Scope to the table.
 */
async function renderTable() {
  render(<PageChromeProvider><Emails /></PageChromeProvider>);
  await waitFor(() => expect(document.querySelector('table tbody tr')).toBeInTheDocument());
  return within(document.querySelector('table tbody tr'));
}

const headers = () =>
  [...document.querySelectorAll('table thead th')].map(th => th.textContent);

describe('the category cell', () => {
  it('carries the sub-category alongside its own category', async () => {
    const row = await renderTable();
    expect(row.getByText(/Payment & Fee/)).toBeInTheDocument();
    expect(row.getByText(/Duplicate Payment Refund Query/)).toBeInTheDocument();
  });

  /**
   * A chain can carry several tags, each with its own sub-category. One
   * Sub-category cell beside two chips could not say which chip it belonged to,
   * so the sub rides its parent and the column goes.
   */
  it('no longer keeps a Sub-category column of its own', async () => {
    await renderTable();
    expect(headers()).not.toContain('Sub-category');
    expect(headers()).toContain('Category');
  });

  it('pairs each tag with its own sub-category when there are several', async () => {
    listPayload = {
      conversations: [{
        ...ANALYSED,
        tags: [
          { category: 'Document & Photo Upload', sub_category: 'Photo Upload Failure' },
          { category: 'Identity Verification',   sub_category: 'Aadhaar OTP Not Received' },
        ],
      }],
      total: 1, unreadCount: 0,
    };
    const row = await renderTable();

    expect(row.getByText(/Photo Upload Failure/)).toBeInTheDocument();
    expect(row.getByText(/Aadhaar OTP Not Received/)).toBeInTheDocument();
  });
});

describe('the analysed mark', () => {
  it('is a tick, not a badge, so it does not crowd the categories', async () => {
    const row = await renderTable();

    expect(row.queryByText('Analysed')).not.toBeInTheDocument();
    expect(row.getByRole('img', { name: 'Analysed' })).toBeInTheDocument();
  });

  // The badge answered "analysed when?" on its title; the tick has to keep it,
  // because a mark on its own says less than the word it replaced.
  it('still says when, on the title', async () => {
    const row = await renderTable();
    expect(row.getByRole('img', { name: 'Analysed' }))
      .toHaveAttribute('title', expect.stringContaining('Analysed'));
  });

  it('says nothing for a chain the AI has never read', async () => {
    listPayload = { conversations: [AWAITING], total: 1, unreadCount: 0 };
    const row = await renderTable();

    expect(row.queryByRole('img', { name: 'Analysed' })).not.toBeInTheDocument();
    // The state that is actually waiting on somebody keeps its badge and its
    // button — that is the one an operator can do something about.
    expect(row.getByText('Awaiting analysis')).toBeInTheDocument();
    expect(row.getByRole('button', { name: 'Analyse now' })).toBeInTheDocument();
  });

  /**
   * A verdict older than the newest reply does not cover it. The badge refused
   * to claim otherwise and the tick has to refuse too, or it would say the AI
   * has read a message it has never seen.
   */
  it('is withheld from a chain that has had a reply since it was read', async () => {
    listPayload = {
      conversations: [{ ...ANALYSED, awaiting_analysis: true, queue_status: 'completed' }],
      total: 1, unreadCount: 0,
    };
    const row = await renderTable();

    expect(row.queryByRole('img', { name: 'Analysed' })).not.toBeInTheDocument();
  });
});

describe('the mobile card', () => {
  it('marks an analysed chain the same way the table does', async () => {
    render(<PageChromeProvider><Emails /></PageChromeProvider>);
    await waitFor(() => expect(document.querySelector('table tbody tr')).toBeInTheDocument());

    // One in the table, one in the card stack — both the tick, neither the badge.
    expect(screen.getAllByRole('img', { name: 'Analysed' })).toHaveLength(2);
    expect(screen.queryByText('Analysed')).not.toBeInTheDocument();
  });
});
