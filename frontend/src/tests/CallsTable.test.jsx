/**
 * CallsTable — does BuzzDial data actually reach the screen?
 *
 * The component renders two layouts at once (mobile cards + desktop table,
 * toggled by CSS), so every query is scoped with `within(table)` to avoid
 * matching the same value twice.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ANSWERED_CALL, MISSED_CALL, C2C_CALL } from './fixtures/buzzdialCalls';

// AudioPlayer (rendered for any call with a recording) reads the JWT from
// context. Stubbing the hook keeps these tests about the table rather than
// about AuthProvider's session bootstrap.
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'jwt', user: { name: 'Admin', role: 'admin' }, isAdmin: true }),
  AuthProvider: ({ children }) => children,
}));

const { default: CallsTable } = await import('../components/CallsTable');

const AGENT_MAP = { 1001: 'Ravi Kumar', 1002: 'Sunita Devi' };

function renderTable(calls, props = {}) {
  render(<CallsTable calls={calls} token="jwt" agentMap={AGENT_MAP} {...props} />);
  return within(screen.getByRole('table'));
}

describe('an answered call', () => {
  it('shows the caller and called numbers', () => {
    const table = renderTable([ANSWERED_CALL]);
    expect(table.getByText('919876543210')).toBeInTheDocument();
    expect(table.getByText('918037126236')).toBeInTheDocument();
  });

  it('shows the agent name and number', () => {
    const table = renderTable([ANSWERED_CALL]);
    expect(table.getByText('Ravi Kumar')).toBeInTheDocument();
    expect(table.getByText('1001')).toBeInTheDocument();
  });

  it('shows the IVR keypress', () => {
    const table = renderTable([ANSWERED_CALL]);
    expect(table.getByText('2')).toBeInTheDocument();
  });

  it('formats the durations as minutes and seconds', () => {
    const table = renderTable([ANSWERED_CALL]);
    expect(table.getByText('4m 12s')).toBeInTheDocument();   // duration 252
    expect(table.getByText('4m 4s')).toBeInTheDocument();    // agent_duration 244
  });

  it('marks it Received because agent_answer_time is set', () => {
    const table = renderTable([ANSWERED_CALL]);
    expect(table.getByText('Received')).toBeInTheDocument();
    expect(table.queryByText('Missed')).not.toBeInTheDocument();
  });

  it('shows the AI category and sub-category', () => {
    const table = renderTable([ANSWERED_CALL]);
    expect(table.getByText('Payment & Fee')).toBeInTheDocument();
    expect(table.getByText('Duplicate Payment Refund Query')).toBeInTheDocument();
  });

  it('renders an audio element pointed at the recording', () => {
    renderTable([ANSWERED_CALL]);
    const audio = document.querySelector('audio');
    expect(audio).toBeInTheDocument();
    expect(audio).toHaveAttribute('src', ANSWERED_CALL.call_recording);
  });

  it('renders the call start, answer and end timestamps', () => {
    const table = renderTable([ANSWERED_CALL]);
    // Rendered through toLocaleString('en-IN'), so assert on the parts that
    // survive any locale-data variation rather than an exact string. All three
    // timestamps fall on the same day, hence getAllByText.
    expect(table.getAllByText(/17 Aug 2026/)).toHaveLength(3);   // start, answer, end
  });
});

describe('a missed call', () => {
  it('marks it Missed when agent_answer_time is empty', () => {
    const table = renderTable([MISSED_CALL]);
    expect(table.getByText('Missed')).toBeInTheDocument();
  });

  it('shows a dash for talk time instead of 0s', () => {
    const table = renderTable([MISSED_CALL]);
    expect(table.getByText('20s')).toBeInTheDocument();     // ring duration
    expect(table.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders no audio player when there is no recording', () => {
    renderTable([MISSED_CALL]);
    expect(document.querySelector('audio')).not.toBeInTheDocument();
  });

  it('shows a dash where the agent name would be', () => {
    const table = renderTable([MISSED_CALL]);
    expect(table.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });
});

describe('a click-to-call leg', () => {
  it('substitutes the agent number for the BuzzDial system number and tags it C2C', () => {
    const table = renderTable([C2C_CALL]);
    expect(table.getByText('C2C')).toBeInTheDocument();
    // 1002 shows twice: once standing in for the system number in the caller
    // column, once in the agent-number column.
    expect(table.getAllByText('1002')).toHaveLength(2);
    expect(table.queryByText('8037126236')).not.toBeInTheDocument();
  });
});

describe('agent identity', () => {
  it('prefers the registered agent name over the one BuzzDial sent', () => {
    const table = renderTable([{ ...ANSWERED_CALL, agent_name: 'sip-account-1001' }]);
    expect(table.getByText('Ravi Kumar')).toBeInTheDocument();
    expect(table.queryByText('sip-account-1001')).not.toBeInTheDocument();
  });

  it('falls back to the BuzzDial name for an unregistered number', () => {
    render(<CallsTable calls={[ANSWERED_CALL]} token="jwt" agentMap={{}} />);
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Ravi Kumar')).toBeInTheDocument();   // came from the payload
  });

  it('shows a station label instead of an agent when the number is a station', () => {
    const table = renderTable([ANSWERED_CALL], {
      stationMap: { 1001: { station_name: 'Lucknow Centre', agents: [] } },
    });
    expect(table.getByText('Lucknow Centre')).toBeInTheDocument();
    expect(table.getByText('STATION')).toBeInTheDocument();
  });

  it('hides agent columns in agent mode', () => {
    const table = renderTable([ANSWERED_CALL], { isAgent: true });
    expect(table.queryByText('Ravi Kumar')).not.toBeInTheDocument();
    expect(table.getByText('919876543210')).toBeInTheDocument();
  });
});

describe('the whole list', () => {
  it('renders one row per call', () => {
    const table = renderTable([ANSWERED_CALL, MISSED_CALL, C2C_CALL]);
    expect(table.getAllByRole('row')).toHaveLength(4);   // 3 calls + header
  });

  it('tells the operator BuzzDial has sent nothing yet', () => {
    render(<CallsTable calls={[]} token="jwt" />);
    expect(screen.getByText('No call records yet')).toBeInTheDocument();
    expect(screen.getByText(/BuzzDial sends webhook events/)).toBeInTheDocument();
  });

  it('distinguishes an empty result from an empty database', () => {
    render(<CallsTable calls={[]} token="jwt" hasFilters />);
    expect(screen.getByText('No matching records')).toBeInTheDocument();
    expect(screen.queryByText(/BuzzDial sends webhook events/)).not.toBeInTheDocument();
  });

  it('offers a ticket action per call when the handler is supplied', () => {
    const onCreateTicket = vi.fn();
    const table = renderTable([ANSWERED_CALL], { onCreateTicket });
    expect(table.getByTitle('Create Ticket')).toBeInTheDocument();
  });
});
