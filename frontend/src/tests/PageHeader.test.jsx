/**
 * The common page header, and the chrome context behind it.
 *
 * The header is now the only date filter and the only refresh timer in the app,
 * so these tests pin the two things every page depends on: the presets compute
 * the range an operator expects, and the auto-sync switch actually starts and
 * stops the tick that reloads whichever page is mounted.
 */
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PageHeader from '../components/PageHeader';
import {
  PageChromeProvider,
  usePageChrome,
  usePageRefresh,
  rangeForPreset,
  toDateInput,
} from '../contexts/PageChromeContext';

/** A stand-in page: registers a loader and reports the range it was given. */
function FakePage({ load, intervalMs = 5000 }) {
  const { dateFrom, dateTo, preset } = usePageChrome();
  usePageRefresh(load, intervalMs);
  return (
    <div>
      <span data-testid="from">{dateFrom}</span>
      <span data-testid="to">{dateTo}</span>
      <span data-testid="preset">{preset}</span>
    </div>
  );
}

function renderChrome({ load = vi.fn(), intervalMs, ...headerProps } = {}) {
  render(
    <PageChromeProvider>
      <PageHeader title="Call Report" subtitle="42 records" {...headerProps} />
      <FakePage load={load} intervalMs={intervalMs} />
    </PageChromeProvider>
  );
  return load;
}

const from = () => screen.getByTestId('from').textContent;
const to   = () => screen.getByTestId('to').textContent;

// ─── Presets ──────────────────────────────────────────────────────────────────

describe('rangeForPreset', () => {
  // A fixed Wednesday, so "7 days" has an unambiguous answer.
  const now = new Date(2026, 7, 19);

  it('Today is a single day, both ends the same', () => {
    expect(rangeForPreset('today', now)).toEqual({ dateFrom: '2026-08-19', dateTo: '2026-08-19' });
  });

  it('7 days is inclusive of today — seven days, not eight', () => {
    expect(rangeForPreset('7d', now)).toEqual({ dateFrom: '2026-08-13', dateTo: '2026-08-19' });
  });

  it('All clears both bounds', () => {
    expect(rangeForPreset('all', now)).toEqual({ dateFrom: '', dateTo: '' });
  });

  it('uses the local calendar day, not UTC', () => {
    // Late evening IST is already the next day in UTC; toISOString() would slip.
    const lateEvening = new Date(2026, 7, 19, 23, 30);
    expect(toDateInput(lateEvening)).toBe('2026-08-19');
  });
});

describe('the preset buttons', () => {
  it('starts unbounded, so a page shows everything until asked otherwise', () => {
    renderChrome();
    expect(from()).toBe('');
    expect(to()).toBe('');
  });

  it('hands the page the range when a preset is picked', async () => {
    renderChrome();
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));

    const today = toDateInput(new Date());
    expect(from()).toBe(today);
    expect(to()).toBe(today);
  });

  it('switches to a custom range when a date is typed', async () => {
    renderChrome();
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByTestId('preset').textContent).toBe('today');

    const fromInput = screen.getByLabelText('From');
    await userEvent.clear(fromInput);
    await userEvent.type(fromInput, '2026-01-15');

    expect(screen.getByTestId('preset').textContent).toBe('custom');
    expect(from()).toBe('2026-01-15');
  });

  it('Reset clears the range back to unbounded', async () => {
    renderChrome();
    await userEvent.click(screen.getByRole('button', { name: 'Today' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));

    expect(from()).toBe('');
    expect(to()).toBe('');
  });

  it('hides the date controls on a page that has no date axis', () => {
    renderChrome({ showFilters: false });
    expect(screen.queryByRole('button', { name: 'Today' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
    // …but keeps the parts every page wants.
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(screen.getByTitle('Refresh now')).toBeInTheDocument();
  });
});

// ─── Auto sync ────────────────────────────────────────────────────────────────

describe('the auto-sync switch', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });

  it('ticks the mounted page on its own interval', () => {
    const load = renderChrome({ intervalMs: 5000 });
    expect(load).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(5000); });
    expect(load).toHaveBeenCalledTimes(1);
    // silent=true, so the tick never flashes the page's spinner.
    expect(load).toHaveBeenCalledWith(true);

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('honours the interval the page asked for', () => {
    const load = renderChrome({ intervalMs: 15_000 });
    act(() => { vi.advanceTimersByTime(5000); });
    expect(load).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('stops ticking when switched off, and resumes when switched back on', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const load = renderChrome({ intervalMs: 5000 });

    await user.click(screen.getByRole('checkbox'));
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(load).not.toHaveBeenCalled();

    await user.click(screen.getByRole('checkbox'));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not poll a hidden tab', () => {
    const load = renderChrome({ intervalMs: 5000 });
    const spy = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    act(() => { vi.advanceTimersByTime(20_000); });
    expect(load).not.toHaveBeenCalled();

    spy.mockReturnValue(false);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('refreshes on demand even while auto sync is off', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const load = renderChrome();

    await user.click(screen.getByRole('checkbox'));       // off
    await user.click(screen.getByTitle('Refresh now'));

    // silent=false — a click should show the spinner.
    expect(load).toHaveBeenCalledWith(false);
  });
});
