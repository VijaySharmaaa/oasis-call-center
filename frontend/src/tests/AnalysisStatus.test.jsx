/**
 * AnalysisStatus — the badge that tells an operator the AI has not read this
 * row yet, and the button that does something about it.
 *
 * Both tabs render this one component, so the cases that matter are: each queue
 * state reads as itself, only the states a person can act on offer a button,
 * and the press reaches the right endpoint with the right force flag.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

let isAdmin = true;
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ token: 'jwt', user: { name: 'Admin' }, isAdmin }),
  AuthProvider: ({ children }) => children,
}));

const { default: AnalysisStatus, analysisStateOf } = await import('../components/AnalysisStatus');

const URL = '/api/calls/BZ-3/analyse';

function renderStatus(item, props = {}) {
  return render(<AnalysisStatus item={item} analyseUrl={URL} {...props} />);
}

function stubFetch(response = { success: true, queued: true }, ok = true) {
  const fetchMock = vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(response) }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The url the component actually called, minus whatever API base is configured. */
const calledPath = fetchMock => fetchMock.mock.calls[0][0].replace(/^https?:\/\/[^/]+/, '');

beforeEach(() => { isAdmin = true; });

describe('what each queue state reads as', () => {
  it('says awaiting analysis for a row nothing has read yet', () => {
    renderStatus({ awaiting_analysis: true, queue_status: null });
    expect(screen.getByText('Awaiting analysis')).toBeInTheDocument();
  });

  it('says queued once a record is sitting in the queue', () => {
    renderStatus({ awaiting_analysis: true, queue_status: 'pending' });
    expect(screen.getByText('Queued')).toBeInTheDocument();
  });

  it('says analysing while a job is in flight', () => {
    renderStatus({ awaiting_analysis: true, queue_status: 'processing' });
    expect(screen.getByText('Analysing…')).toBeInTheDocument();
  });

  it('says analysis failed for a record the worker gave up on', () => {
    renderStatus({ awaiting_analysis: false, queue_status: 'failed' });
    expect(screen.getByText('Analysis failed')).toBeInTheDocument();
  });

  // The common case by far: rendering anything for a finished row would put a
  // badge on every line of the table.
  it('renders nothing at all for a row with a current verdict', () => {
    const { container } = renderStatus({ awaiting_analysis: false, queue_status: 'completed' });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a call that has no recording to read', () => {
    // The backend never marks one awaiting, so there is no state to show.
    const { container } = renderStatus({ awaiting_analysis: false, queue_status: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('reports in-flight over awaiting, which is the more useful of the two', () => {
    expect(analysisStateOf({ awaiting_analysis: true, queue_status: 'processing' })).toBe('processing');
  });

  /* A worker killed between writing its verdict and releasing its lock leaves a
     row saying `processing` for something that is fully analysed. Reading the
     queue row first made that chain claim to be "Analysing…" forever, printed
     next to the very category it had already been given. */
  it('says nothing for a stale lock left on a record that already has its verdict', () => {
    const { container } = renderStatus({ awaiting_analysis: false, queue_status: 'processing' });
    expect(container).toBeEmptyDOMElement();
    expect(analysisStateOf({ awaiting_analysis: false, queue_status: 'processing' })).toBeNull();
  });

  it('says nothing for a re-run queued behind a verdict that is still current', () => {
    expect(analysisStateOf({ awaiting_analysis: false, queue_status: 'pending' })).toBeNull();
  });

  // A permanent failure is the exception: nothing is coming, and it is the one
  // state a person has to act on, so it is reported whatever else is true.
  it('still reports a permanent failure', () => {
    expect(analysisStateOf({ awaiting_analysis: false, queue_status: 'failed' })).toBe('failed');
    expect(analysisStateOf({ awaiting_analysis: true,  queue_status: 'failed' })).toBe('failed');
  });
});

describe('the analysed badge', () => {
  const ANALYSED = { awaiting_analysis: false, queue_status: 'completed', analysed_at: '2026-08-18T09:05:00.000Z' };

  it('is off by default, so the Call Report is not a column of stickers', () => {
    const { container } = renderStatus(ANALYSED);
    expect(container).toBeEmptyDOMElement();
    expect(analysisStateOf(ANALYSED)).toBeNull();
  });

  it('is shown to a list that opts in', () => {
    renderStatus(ANALYSED, { showAnalysed: true });
    expect(screen.getByText('Analysed')).toBeInTheDocument();
    expect(analysisStateOf(ANALYSED, { showAnalysed: true })).toBe('analysed');
  });

  it('says when it was analysed, which is the question the badge provokes', () => {
    renderStatus(ANALYSED, { showAnalysed: true });
    expect(screen.getByText('Analysed').closest('span')).toHaveAttribute('title', expect.stringContaining('Analysed'));
  });

  it('offers no button — a current verdict is not waiting on anyone', () => {
    renderStatus(ANALYSED, { showAnalysed: true });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  /* The states that mean "no current verdict" still win: a chain with a reply
     since its last reading is outstanding, not analysed. */
  it('gives way to every unsettled state', () => {
    const opts = { showAnalysed: true };
    expect(analysisStateOf({ ...ANALYSED, awaiting_analysis: true, queue_status: null }, opts)).toBe('awaiting');
    expect(analysisStateOf({ ...ANALYSED, awaiting_analysis: true, queue_status: 'pending' }, opts)).toBe('queued');
    expect(analysisStateOf({ ...ANALYSED, awaiting_analysis: true, queue_status: 'processing' }, opts)).toBe('processing');
    expect(analysisStateOf({ ...ANALYSED, queue_status: 'failed' }, opts)).toBe('failed');
  });

  it('says nothing for a record that was never analysed at all', () => {
    // No verdict and nothing waiting: a call with no recording, say. Claiming
    // "Analysed" of it would be a lie in the other direction.
    const { container } = renderStatus({ awaiting_analysis: false, queue_status: null }, { showAnalysed: true });
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the button', () => {
  it('is offered on a row that is waiting on a person, not on the worker', () => {
    renderStatus({ awaiting_analysis: true, queue_status: null });
    expect(screen.getByRole('button', { name: 'Analyse now' })).toBeInTheDocument();
  });

  it('offers a retry on a permanently failed row', () => {
    renderStatus({ awaiting_analysis: false, queue_status: 'failed' });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('is not offered while the worker already has the job', () => {
    renderStatus({ awaiting_analysis: true, queue_status: 'pending' });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('is hidden from a non-admin, who cannot spend Gemini quota', () => {
    isAdmin = false;
    renderStatus({ awaiting_analysis: true, queue_status: null });
    expect(screen.getByText('Awaiting analysis')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('pressing it', () => {
  it('posts to the analyse endpoint', async () => {
    const fetchMock = stubFetch();
    renderStatus({ awaiting_analysis: true, queue_status: null });

    await userEvent.click(screen.getByRole('button', { name: 'Analyse now' }));

    expect(calledPath(fetchMock)).toBe(URL);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });

  it('forces the re-run when the stored verdict is the thing being replaced', async () => {
    const fetchMock = stubFetch();
    // A chain analysed last week that has had a reply since.
    renderStatus({ awaiting_analysis: true, queue_status: 'completed' });

    await userEvent.click(screen.getByRole('button', { name: 'Analyse now' }));

    expect(calledPath(fetchMock)).toBe(`${URL}?force=true`);
  });

  it('forces a retry of a failed record too', async () => {
    const fetchMock = stubFetch();
    renderStatus({ awaiting_analysis: false, queue_status: 'failed' });

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(calledPath(fetchMock)).toBe(`${URL}?force=true`);
  });

  // Without this the row looks inert until the next poll lands, and the
  // operator presses again.
  it('flips the row to queued straight away', async () => {
    stubFetch();
    const onQueued = vi.fn();
    renderStatus({ awaiting_analysis: true, queue_status: null }, { onQueued });

    await userEvent.click(screen.getByRole('button', { name: 'Analyse now' }));

    await waitFor(() => expect(screen.getByText('Queued')).toBeInTheDocument());
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(onQueued).toHaveBeenCalled();
  });

  it('shows the server’s reason when the queueing is refused', async () => {
    stubFetch({ error: 'This call has no recording to analyse' }, false);
    renderStatus({ awaiting_analysis: true, queue_status: null });

    await userEvent.click(screen.getByRole('button', { name: 'Analyse now' }));

    await waitFor(() =>
      expect(screen.getByText('This call has no recording to analyse')).toBeInTheDocument());
    // Still pressable — the row did not lie about having been queued.
    expect(screen.getByRole('button', { name: 'Analyse now' })).toBeInTheDocument();
  });
});
