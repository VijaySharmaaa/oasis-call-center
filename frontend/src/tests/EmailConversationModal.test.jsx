/**
 * EmailConversationModal — a correspondent's whole exchange, as a chat.
 *
 * What these tests pin is the thing the feature exists for: every message the
 * person sent is on screen at once, our replies are visibly the other side of
 * the conversation, and the AI verdict shown beside them is the one formed from
 * the whole chain rather than from whichever message was opened.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'jwt', user: { name: 'Admin', role: 'admin' }, isAdmin: true }),
  AuthProvider: ({ children }) => children,
}));

const { default: EmailConversationModal } = await import('../components/EmailConversationModal');

const CONVERSATION = {
  id: 'aasha@example.com',
  participant_email: 'aasha@example.com',
  participant_name: 'Km Aasha',
  message_count: 3,
  inbound_count: 2,
  outbound_count: 1,
  unread_count: 1,
  last_subject: 'Payment reference',
  last_inbound_id: 'm3',
  first_message_at: '2026-08-17T10:00:00.000Z',
  last_message_at: '2026-08-18T09:00:00.000Z',
  needs_analysis: false,
  messages: [
    { id: 'm1', direction: 'inbound', subject: 'Fee debited twice', from_name: 'Km Aasha',
      from_email: 'aasha@example.com', body_text: 'Sir mera fee do baar cut gaya hai.',
      received_at: '2026-08-17T10:00:00.000Z', attachments: [], body_truncated: false, has_html: false },
    { id: 'm2', direction: 'outbound', subject: 'Re: Fee debited twice', from_name: 'UPTET Support',
      from_email: 'support@upessc.org', body_text: 'Please share the transaction reference.',
      received_at: '2026-08-17T13:00:00.000Z', attachments: [], body_truncated: false, has_html: false },
    { id: 'm3', direction: 'inbound', subject: 'Payment reference', from_name: 'Km Aasha',
      from_email: 'aasha@example.com', body_text: 'Transaction ref 4471xx hai.',
      received_at: '2026-08-18T09:00:00.000Z',
      attachments: [{ attachment_id: 'att1', filename: 'receipt.pdf', size: 900 }],
      body_truncated: true, has_html: true },
  ],
  analysis: {
    status: 'completed',
    category: 'Payment & Fee',
    tags: [{ category: 'Payment & Fee', sub_category: 'Duplicate Payment Refund Query' }],
    ai_insight: 'Duplicate payment refund request',
    summary: 'Fee debited twice. Refund requested, reference supplied.',
    bugs: '-',
    requested_action: 'Refund',
    language: ['Hinglish'],
    message_count: 3,
    model_used: 'gemini-2.5-flash',
    processed_at: '2026-08-18T09:05:00.000Z',
  },
};

const SENT_BUBBLE = {
  id: 'sent-1', direction: 'outbound', subject: 'Re: Payment reference',
  from_name: 'UPTET Support', from_email: 'support@upessc.org',
  body_text: 'We have raised this with the payment team.',
  received_at: '2026-08-19T10:00:00.000Z', attachments: [],
  body_truncated: false, body_trimmed: false, has_html: false,
};

let fetchMock;
/**
 * @param conversation what GET /conversations/:id returns
 * @param status       what /sync-status says the mailbox may do
 * @param reply        what POST /reply returns, or an Error to reject with
 */
function stub(conversation = CONVERSATION, { status = { configured: true, can_send: true, can_modify: true }, reply } = {}) {
  fetchMock = vi.fn(async (url, options = {}) => {
    const u = String(url);
    if (u.includes('/sync-status')) return { ok: true, json: async () => status };
    if (u.includes('/reply')) {
      if (reply instanceof Error) return { ok: false, status: 502, json: async () => ({ error: reply.message }) };
      return { ok: true, status: 201, json: async () => (reply || {
        success: true, gmail_id: 'sent-1', message: SENT_BUBBLE,
        conversation: { message_count: 4, outbound_count: 2 },
      })};
    }
    return { ok: true, json: async () => conversation };
  });
  vi.stubGlobal('fetch', fetchMock);
}

/** The call to a given path, whenever it happened. Positional indexing broke
 *  as soon as the modal gained a second fetch on open. */
function callTo(fragment) {
  const call = fetchMock.mock.calls.find(c => String(c[0]).includes(fragment));
  return call ? { url: String(call[0]), options: call[1] || {} } : null;
}

/** The POST the composer fired, if any. */
function sentReply() {
  const call = fetchMock.mock.calls.find(c => String(c[0]).includes('/reply'));
  return call ? { url: String(call[0]), body: JSON.parse(call[1].body) } : null;
}

beforeEach(() => {
  stub();
  // The modal scrolls itself to the newest message; jsdom has no layout.
  Element.prototype.scrollIntoView = vi.fn();
});

/** Wait for the initial load to settle. */
async function open(props = {}) {
  render(<EmailConversationModal conversationId="aasha@example.com" onClose={() => {}} {...props} />);
  await screen.findByText('Km Aasha');
}

describe('the chain', () => {
  it('asks for the conversation by the correspondent address, encoded', async () => {
    await open();
    expect(fetchMock.mock.calls[0][0]).toContain('/api/emails/conversations/aasha%40example.com');
  });

  it('shows every message at once, in the order they were sent', async () => {
    await open();
    const bodies = ['Sir mera fee do baar cut gaya hai.', 'Please share the transaction reference.', 'Transaction ref 4471xx hai.'];
    for (const body of bodies) expect(screen.getByText(body)).toBeInTheDocument();

    const rendered = document.body.textContent;
    expect(rendered.indexOf(bodies[0])).toBeLessThan(rendered.indexOf(bodies[1]));
    expect(rendered.indexOf(bodies[1])).toBeLessThan(rendered.indexOf(bodies[2]));
  });

  it('labels our own replies as support, so the chat has two sides', async () => {
    await open();
    expect(screen.getByText(/^Support ·/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Km Aasha ·/)).toHaveLength(2);
  });

  it('heads the modal with the person and the size of the chain', async () => {
    await open();
    expect(screen.getByText('aasha@example.com')).toBeInTheDocument();
    // "3 messages" also appears in the verdict ("3 messages read"), so match the
    // header line as a whole rather than the fragment.
    expect(screen.getByText(/3 messages · 1 replied/)).toBeInTheDocument();
    expect(screen.getByText(/1 unread/)).toBeInTheDocument();
  });

  it('repeats a subject only when it changes', async () => {
    await open();
    // Three messages, two distinct subjects — the reply keeps its parent's.
    expect(screen.getAllByText('Fee debited twice')).toHaveLength(1);
    expect(screen.getAllByText('Payment reference')).toHaveLength(1);
  });

  /* The server hands the bubble the message with the quoted thread, signature
     and disclaimer taken off. Nothing is hidden silently: a trimmed bubble
     offers the original. */
  it('offers the original when the body was trimmed', async () => {
    stub({
      ...CONVERSATION,
      messages: [{ ...CONVERSATION.messages[0], body_trimmed: true, body_truncated: false, attachments: [] }],
    });
    await open();

    const button = screen.getByRole('button', { name: /show original/i });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('title', expect.stringContaining('as it arrived'));
  });

  it('says nothing extra on a bubble that was not edited', async () => {
    stub({
      ...CONVERSATION,
      messages: [{ ...CONVERSATION.messages[0], body_trimmed: false, body_truncated: false, has_html: false, attachments: [] }],
    });
    await open();
    expect(screen.queryByRole('button', { name: /show original|open message|read full/i })).not.toBeInTheDocument();
  });

  it('offers the full message when the body was capped, and lists attachments', async () => {
    await open();
    expect(screen.getByText('receipt.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /read full message/i })).toBeInTheDocument();
  });
});

describe('the verdict', () => {
  it('shows one analysis for the whole chain, saying how much it read', async () => {
    await open();
    expect(screen.getByText(/Payment & Fee/)).toBeInTheDocument();
    expect(screen.getByText('Duplicate payment refund request')).toBeInTheDocument();
    expect(screen.getByText(/3 messages read/)).toBeInTheDocument();
  });

  it('marks the chain analysed, so it reads the same as its row in the list', async () => {
    await open();
    expect(screen.getByText('Analysed')).toBeInTheDocument();
  });

  it('withholds that badge once a reply has landed since the verdict', async () => {
    // The verdict on screen no longer covers the newest message, so calling the
    // chain "Analysed" would contradict the banner right below it.
    stub({ ...CONVERSATION, needs_analysis: true });
    await open();
    expect(screen.queryByText('Analysed')).not.toBeInTheDocument();
  });

  it('says so when a reply has landed since the verdict was formed', async () => {
    stub({ ...CONVERSATION, needs_analysis: true });
    await open();
    expect(screen.getByText(/New mail has arrived since this verdict/i)).toBeInTheDocument();
  });

  it('re-reads the chain rather than one message, forcing a settled verdict', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: /re-analyse/i }));

    const analyse = callTo('/analyse');
    expect(analyse.url).toContain('/api/emails/conversations/aasha%40example.com/analyse?force=true');
    expect(analyse.options.method).toBe('POST');
  });
});

describe('read state', () => {
  it('puts the whole chain back in the unread pile', async () => {
    const onRead = vi.fn();
    const onClose = vi.fn();
    await open({ onRead, onClose });

    await userEvent.click(screen.getByRole('button', { name: /unread/i }));

    const patch = callTo('/read');
    expect(patch.url).toContain('/api/emails/conversations/aasha%40example.com/read');
    expect(patch.options.method).toBe('PATCH');
    expect(JSON.parse(patch.options.body)).toEqual({ read: false });
    await waitFor(() => expect(onRead).toHaveBeenCalledWith('aasha@example.com', false));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('replying from the chat', () => {
  it('sends what was typed to the conversation reply endpoint', async () => {
    await open();

    await userEvent.type(screen.getByLabelText(/^reply$/i), 'We have raised this with the payment team.');
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(sentReply()).not.toBeNull());
    expect(sentReply().url).toContain('/api/emails/conversations/aasha%40example.com/reply');
    expect(sentReply().body).toEqual({ body: 'We have raised this with the payment team.' });
  });

  it('appends the sent message as a bubble, so the chat does not wait for a poll', async () => {
    await open();
    await userEvent.type(screen.getByLabelText(/^reply$/i), 'Refund issued.');
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(await screen.findByText('We have raised this with the payment team.')).toBeInTheDocument();
    // Our side of the conversation, not the candidate's.
    expect(screen.getAllByText(/^Support ·/).length).toBeGreaterThan(1);
  });

  it('clears the box on success, and tells the list the chain moved', async () => {
    const onReplied = vi.fn();
    await open({ onReplied });

    await userEvent.type(screen.getByLabelText(/^reply$/i), 'Answered.');
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }));

    await waitFor(() => expect(screen.getByLabelText(/^reply$/i)).toHaveValue(''));
    expect(onReplied).toHaveBeenCalled();
  });

  it('will not send an empty reply', async () => {
    await open();
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/^reply$/i), '   ');
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled();
    expect(sentReply()).toBeNull();
  });

  it('sends on Enter and breaks the line on Shift+Enter', async () => {
    await open();
    const box = screen.getByLabelText(/^reply$/i);

    await userEvent.type(box, 'first{Shift>}{Enter}{/Shift}second');
    expect(box).toHaveValue('first\nsecond');
    expect(sentReply()).toBeNull();

    await userEvent.type(box, '{Enter}');
    await waitFor(() => expect(sentReply()).not.toBeNull());
    expect(sentReply().body).toEqual({ body: 'first\nsecond' });
  });

  /* A failed send that also loses what was typed is the worst of both. */
  it('keeps the draft and shows why when the send fails', async () => {
    stub(CONVERSATION, { reply: new Error('Gmail refused the message') });
    await open();

    await userEvent.type(screen.getByLabelText(/^reply$/i), 'Please try again.');
    await userEvent.click(screen.getByRole('button', { name: /^send$/i }));

    expect(await screen.findByText(/Gmail refused the message/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^reply$/i)).toHaveValue('Please try again.');
  });

  it('disables itself and says why when the mailbox cannot send', async () => {
    stub(CONVERSATION, { status: { configured: true, can_send: false, can_modify: false } });
    await open();

    expect(screen.getByLabelText(/^reply$/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled();
    expect(screen.getByText(/not authorised to send/i)).toBeInTheDocument();
  });
});

describe('when it cannot load', () => {
  it('surfaces the error instead of an empty chat', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) })));
    render(<EmailConversationModal conversationId="nobody@example.com" onClose={() => {}} />);
    expect(await screen.findByText('Not found')).toBeInTheDocument();
  });
});
