/**
 * The resolution tint on a mailbox row.
 *
 * Green means a ticket for that sender reached Resolved or Closed — the server
 * decides that and ships it as `is_resolved`. Red is everything else, which
 * deliberately includes senders nobody has raised a ticket for: the colour
 * answers "is there anything left to do here", and for those the answer is yes.
 */
import { render, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PageChromeProvider } from '../contexts/PageChromeContext';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'jwt', user: { name: 'Admin', role: 'admin' }, isAdmin: true }),
  AuthProvider: ({ children }) => children,
}));
vi.mock('../hooks/useCalls', () => ({ useDateRange: () => ({ minDate: '2026-01-01' }) }));
vi.mock('../components/EmailConversationModal', () => ({ default: () => <div data-testid="chat" /> }));

const { default: Emails } = await import('../pages/Emails');

const CARD = {
  id: 'aasha@example.com',
  participant_email: 'aasha@example.com',
  participant_name: 'Km Aasha',
  last_subject: 'Payment reference',
  last_message_at: '2026-08-18T09:00:00.000Z',
  message_count: 2,
  unread_count: 0,
};

let listPayload;

function stub(conversations) {
  listPayload = { conversations, total: conversations.length, unreadCount: 0 };
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    const u = String(url);
    if (u.includes('/conversations')) return { ok: true, json: async () => listPayload };
    if (u.includes('/sync-status'))   return { ok: true, json: async () => ({ configured: true, can_send: true }) };
    if (u.includes('/analysis/stats'))return { ok: true, json: async () => ({ queue: {}, coverage: {} }) };
    return { ok: true, json: async () => ({ schema: [] }) };
  }));
}

/** Both layouts render at once in jsdom; the table is the one under test. */
function rows() {
  return [...document.querySelectorAll('table tbody tr')];
}

async function renderWith(conversations) {
  stub(conversations);
  render(<PageChromeProvider><Emails /></PageChromeProvider>);
  await waitFor(() => expect(rows()).toHaveLength(conversations.length));
  return rows();
}

beforeEach(() => { vi.unstubAllGlobals(); });

describe('Emails row resolution tint', () => {
  it('tints a resolved sender green', async () => {
    const [row] = await renderWith([{ ...CARD, is_resolved: true }]);
    expect(row.className).toContain('bg-emerald-50');
    expect(row.className).not.toContain('bg-red-50');
  });

  it('tints an unresolved sender red', async () => {
    const [row] = await renderWith([{ ...CARD, is_resolved: false }]);
    expect(row.className).toContain('bg-red-50');
    expect(row.className).not.toContain('bg-emerald-50');
  });

  it('treats a sender with no ticket at all as unresolved', async () => {
    const [row] = await renderWith([CARD]);
    expect(row.className).toContain('bg-red-50');
  });

  it('colours each row independently', async () => {
    const [resolved, open] = await renderWith([
      { ...CARD, is_resolved: true },
      { ...CARD, id: 'ravi@example.com', participant_email: 'ravi@example.com', is_resolved: false },
    ]);
    expect(resolved.className).toContain('bg-emerald-50');
    expect(open.className).toContain('bg-red-50');
  });
});

/* The tint says it in colour; the column says it in words. Colour alone asks
   the reader to know what green means, and gives nothing at all to anyone who
   cannot separate the two hues. */
describe('the Resolution column', () => {
  it('says Resolved for a sender whose ticket was settled', async () => {
    const [row] = await renderWith([{ ...CARD, is_resolved: true }]);
    expect(row.textContent).toContain('Resolved');
    expect(row.textContent).not.toContain('Unresolved');
  });

  it('says Unresolved otherwise, including when no ticket exists', async () => {
    const [withTicket] = await renderWith([{ ...CARD, is_resolved: false }]);
    expect(withTicket.textContent).toContain('Unresolved');

    const [without] = await renderWith([CARD]);
    expect(without.textContent).toContain('Unresolved');
  });

  it('explains what the word means on hover', async () => {
    const [row] = await renderWith([{ ...CARD, is_resolved: true }]);
    const chip = [...row.querySelectorAll('[title]')].find(el => el.textContent.trim() === 'Resolved');
    expect(chip).toHaveAttribute('title', expect.stringContaining('Resolved or Closed'));
  });

  it('sits under its own header', async () => {
    await renderWith([{ ...CARD, is_resolved: true }]);
    const headers = [...document.querySelectorAll('thead th')].map(th => th.textContent);
    expect(headers).toContain('Resolution');
  });
});
