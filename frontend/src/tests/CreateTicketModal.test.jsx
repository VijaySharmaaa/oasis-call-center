/**
 * CreateTicketModal — one form, two sources.
 *
 * A call identifies the customer by phone number and an email by address, and
 * the backend stores whichever arrives. These tests pin the request body for
 * both paths, because a ticket that reaches Mongo with neither contact detail
 * is a ticket nobody can follow up on.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'jwt', user: { name: 'Ravi Kumar', agent_number: '1001', role: 'agent' }, isAdmin: false }),
  AuthProvider: ({ children }) => children,
}));

const { default: CreateTicketModal } = await import('../components/CreateTicketModal');

const EMAIL = {
  id: 'm1',
  subject: 'Payment debited but form incomplete',
  from_email: 'aasha@example.com',
  from_name: 'Aasha',
};

const CALL = {
  call_id: 'BZ-1',
  caller_number: '919876543210',
  agent_number: '1001',
  agent_name: 'Ravi',
};

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'tk1', ticket_number: 'TKT-0001' }) }));
  vi.stubGlobal('fetch', fetchMock);
});

/** The JSON body of the single POST the modal fires on submit. */
function postedBody() {
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

describe('created from an email', () => {
  it('seeds the title from the subject and the name from the sender', () => {
    render(<CreateTicketModal email={EMAIL} onClose={() => {}} />);
    expect(screen.getByLabelText(/title/i)).toHaveValue(EMAIL.subject);
    expect(screen.getByLabelText(/customer name/i)).toHaveValue('Aasha');
  });

  it('shows the sender address as a read-only contact detail', () => {
    render(<CreateTicketModal email={EMAIL} onClose={() => {}} />);
    const field = screen.getByLabelText(/customer email/i);
    expect(field).toHaveValue('aasha@example.com');
    expect(field).toHaveAttribute('readonly');
    expect(screen.queryByLabelText(/customer number/i)).not.toBeInTheDocument();
  });

  it('posts the message id, the subject and the address — and no phone number', async () => {
    const onCreated = vi.fn();
    render(<CreateTicketModal email={EMAIL} onClose={() => {}} onCreated={onCreated} />);

    await userEvent.click(screen.getByRole('button', { name: /create ticket/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(postedBody()).toMatchObject({
      source:          'email',
      email_id:        'm1',
      email_subject:   EMAIL.subject,
      customer_email:  'aasha@example.com',
      customer_number: null,
      call_id:         null,
      customer_name:   'Aasha',
      title:           EMAIL.subject,
    });
    expect(onCreated).toHaveBeenCalled();
  });

  it('carries an edited title rather than the original subject', async () => {
    render(<CreateTicketModal email={EMAIL} onClose={() => {}} />);
    const title = screen.getByLabelText(/title/i);
    await userEvent.clear(title);
    await userEvent.type(title, 'Refund for duplicate payment');

    await userEvent.click(screen.getByRole('button', { name: /create ticket/i }));
    expect(postedBody().title).toBe('Refund for duplicate payment');
  });
});

describe('created from a call', () => {
  it('still posts the caller number and the call id', async () => {
    render(<CreateTicketModal call={CALL} onClose={() => {}} />);

    const title = screen.getByLabelText(/title/i);
    await userEvent.type(title, 'Callback requested');
    await userEvent.click(screen.getByRole('button', { name: /create ticket/i }));

    expect(postedBody()).toMatchObject({
      source:          'call',
      call_id:         'BZ-1',
      customer_number: '919876543210',
      customer_email:  null,
      email_id:        null,
      title:           'Callback requested',
    });
  });

  it('leaves the title empty — a call has no subject line to borrow', () => {
    render(<CreateTicketModal call={CALL} onClose={() => {}} />);
    expect(screen.getByLabelText(/title/i)).toHaveValue('');
  });
});

describe('validation', () => {
  it('does not post without a title', async () => {
    render(<CreateTicketModal call={CALL} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /create ticket/i }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
