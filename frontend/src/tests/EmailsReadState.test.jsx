/**
 * The unread state of a chat card.
 *
 * Read state is one fact shared with Gmail now, so a card has to answer to
 * three things: the operator opening the chat here, the server's own view on
 * the next poll, and somebody marking the mail unread in Gmail — which reaches
 * the card the same way, through a poll.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PageChromeProvider } from '../contexts/PageChromeContext';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'jwt', user: { name: 'Admin', role: 'admin' }, isAdmin: true }),
  AuthProvider: ({ children }) => children,
}));
vi.mock('../hooks/useCalls', () => ({ useDateRange: () => ({ minDate: '2026-01-01' }) }));

// The chat itself is covered by its own suite; here it only has to open.
vi.mock('../components/EmailConversationModal', () => ({
  default: ({ conversationId, onClose }) => (
    <div data-testid="chat">
      chat:{conversationId}
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

const { default: Emails } = await import('../pages/Emails');

const UNREAD_CARD = {
  id: 'aasha@example.com',
  participant_email: 'aasha@example.com',
  participant_name: 'Km Aasha',
  last_subject: 'Payment reference',
  last_message_at: '2026-08-18T09:00:00.000Z',
  message_count: 3,
  unread_count: 2,
  category: 'Payment & Fee',
  analysed_at: '2026-08-18T09:05:00.000Z',
  awaiting_analysis: false,
  queue_status: 'completed',
};

let fetchMock;
let listPayload;

function stub() {
  listPayload = { conversations: [UNREAD_CARD], total: 1, unreadCount: 1 };
  fetchMock = vi.fn(async (url, options = {}) => {
    const u = String(url);
    if (u.includes('/conversations?') || u.endsWith('/conversations')) {
      return { ok: true, json: async () => listPayload };
    }
    if (u.includes('/read')) return { ok: true, json: async () => ({ success: true, read: options.body?.includes('true') }) };
    if (u.includes('/sync-status')) return { ok: true, json: async () => ({ configured: true, can_send: true }) };
    if (u.includes('/analysis/stats')) return { ok: true, json: async () => ({ queue: {}, coverage: {} }) };
    return { ok: true, json: async () => ({ schema: [] }) };
  });
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(stub);

/**
 * The page renders the desktop table AND the mobile cards, so every row appears
 * twice in the DOM — CSS hides one, jsdom does not. Scope to the table.
 */
function row() {
  return document.querySelector('table tbody tr');
}

async function renderPage() {
  render(<PageChromeProvider><Emails /></PageChromeProvider>);
  await waitFor(() => expect(row()).toBeInTheDocument());
}

/** The unread dot lives on the row and is titled with the count. */
function unreadDot() {
  return row()?.querySelector('[title$="unread"]');
}

/** The PATCH the row fired, if any. */
function readPatch() {
  const call = fetchMock.mock.calls.find(c => String(c[0]).includes('/read'));
  return call ? { url: String(call[0]), body: JSON.parse(call[1].body) } : null;
}

describe('opening a chat', () => {
  /* The mark-read request belongs to the chat window, which knows when the
     chain has actually been put in front of somebody. Fired from here it raced
     the window's own load and left it reporting counts from before the read.
     The row still answers the click instantly — that part is local. */
  it('leaves the request to the chat window rather than racing it', async () => {
    await renderPage();
    await userEvent.click(row());

    expect(screen.getByTestId('chat')).toHaveTextContent('aasha@example.com');
    expect(readPatch()).toBeNull();
  });

  it('clears the dot at once rather than waiting for the next poll', async () => {
    await renderPage();
    await userEvent.click(row());

    // The row answers the click; a triage list that lags by a poll gets
    // clicked twice.
    await waitFor(() => expect(unreadDot()).not.toBeInTheDocument());
    expect(screen.getByTestId('chat')).toHaveTextContent('aasha@example.com');
  });
});

describe('what the server says wins on the next poll', () => {
  it('brings the dot back when the chain is unread again', async () => {
    await renderPage();
    await userEvent.click(row());
    await waitFor(() => expect(unreadDot()).not.toBeInTheDocument());

    // Somebody marked it unread in Gmail; the sync cleared our read marker and
    // the rollup counts it unread once more.
    listPayload = { conversations: [{ ...UNREAD_CARD, unread_count: 1 }], total: 1, unreadCount: 1 };
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => expect(unreadDot()).toBeInTheDocument());
  });

  it('drops the dot when the mail was read in Gmail instead of here', async () => {
    await renderPage();
    expect(unreadDot()).toBeInTheDocument();

    listPayload = { conversations: [{ ...UNREAD_CARD, unread_count: 0 }], total: 1, unreadCount: 0 };
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => expect(unreadDot()).not.toBeInTheDocument());
  });
});
