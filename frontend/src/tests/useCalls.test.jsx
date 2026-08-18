/**
 * useCalls / useStats / useDateRange — the frontend half of the BuzzDial
 * contract: does the app ask the API the right question, and does it hold on to
 * the answer?
 *
 * fetch is stubbed, so these assert the request the app builds and the state it
 * derives — not that a server is reachable.
 */
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useCalls, useStats, useDateRange, initiateCall, pollClick2Call } from '../hooks/useCalls';
import { CALLS_RESPONSE, STATS_RESPONSE, ANSWERED_CALL, stubFetch } from './fixtures/buzzdialCalls';

/** The querystring of the most recent /api/calls request. */
function lastQuery(fetchMock) {
  const [url] = fetchMock.mock.calls.at(-1);
  return new URL(String(url), 'http://localhost').searchParams;
}

describe('useCalls — receiving call data', () => {
  it('exposes the calls and total the API returned', async () => {
    stubFetch({ '/api/calls': CALLS_RESPONSE });
    const { result } = renderHook(() => useCalls({ token: 'jwt' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.calls).toHaveLength(3);
    expect(result.current.total).toBe(3);
    expect(result.current.error).toBeNull();
  });

  it('keeps every BuzzDial field intact through the hook', async () => {
    stubFetch({ '/api/calls': CALLS_RESPONSE });
    const { result } = renderHook(() => useCalls({ token: 'jwt' }));

    await waitFor(() => expect(result.current.calls.length).toBe(3));
    expect(result.current.calls[0]).toEqual(ANSWERED_CALL);
  });

  it('sends the bearer token', async () => {
    const fetchMock = stubFetch({ '/api/calls': CALLS_RESPONSE });
    renderHook(() => useCalls({ token: 'jwt-abc' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer jwt-abc');
  });

  it('omits the auth header when there is no token', async () => {
    const fetchMock = stubFetch({ '/api/calls': CALLS_RESPONSE });
    renderHook(() => useCalls({ token: null }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][1].headers).toEqual({});
  });

  it('always sends limit and offset', async () => {
    const fetchMock = stubFetch({ '/api/calls': CALLS_RESPONSE });
    renderHook(() => useCalls({ token: 'jwt', page: 3, pageSize: 25 }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const params = lastQuery(fetchMock);
    expect(params.get('limit')).toBe('25');
    expect(params.get('offset')).toBe('50');   // (page - 1) * pageSize
  });

  it('forwards every filter the report page can set', async () => {
    const fetchMock = stubFetch({ '/api/calls': CALLS_RESPONSE });
    renderHook(() => useCalls({
      token: 'jwt', search: '9876543210', status: 'missed',
      dateFrom: '2026-08-01', dateTo: '2026-08-17',
      agentNumber: '1001', sortBy: 'duration', sortDir: 'asc',
    }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const params = lastQuery(fetchMock);
    expect(params.get('search')).toBe('9876543210');
    expect(params.get('status')).toBe('missed');
    expect(params.get('agentNumber')).toBe('1001');
    expect(params.get('sortBy')).toBe('duration');
    expect(params.get('sortDir')).toBe('asc');
    // Date-only inputs are widened to cover the whole day.
    expect(params.get('dateFrom')).toBe('2026-08-01T00:00');
    expect(params.get('dateTo')).toBe('2026-08-17T23:59');
  });

  it('leaves empty filters out of the querystring entirely', async () => {
    const fetchMock = stubFetch({ '/api/calls': CALLS_RESPONSE });
    renderHook(() => useCalls({ token: 'jwt', search: '', status: '' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const params = lastQuery(fetchMock);
    expect(params.has('search')).toBe(false);
    expect(params.has('status')).toBe(false);
  });

  it('refetches when a filter changes', async () => {
    const fetchMock = stubFetch({ '/api/calls': CALLS_RESPONSE });
    const { rerender } = renderHook(props => useCalls(props), {
      initialProps: { token: 'jwt', status: '' },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    rerender({ token: 'jwt', status: 'received' });
    await waitFor(() => expect(lastQuery(fetchMock).get('status')).toBe('received'));
  });

  it('polls every 5 seconds so new webhook data appears without a reload', async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch({ '/api/calls': CALLS_RESPONSE });
    renderHook(() => useCalls({ token: 'jwt' }));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('stops polling once unmounted', async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch({ '/api/calls': CALLS_RESPONSE });
    const { unmount } = renderHook(() => useCalls({ token: 'jwt' }));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('useCalls — when things go wrong', () => {
  it('surfaces a network failure without wedging in a loading state', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Failed to fetch'))));
    const { result } = renderHook(() => useCalls({ token: 'jwt' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to fetch');
    expect(result.current.calls).toEqual([]);
  });

  it('treats a response with no calls key as an empty list', async () => {
    stubFetch({ '/api/calls': {} });
    const { result } = renderHook(() => useCalls({ token: 'jwt' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.calls).toEqual([]);
    expect(result.current.total).toBe(0);
  });

  it('recovers on the next poll after a failed one', async () => {
    let attempt = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('Failed to fetch');
      return { ok: true, json: async () => CALLS_RESPONSE };
    }));

    const { result } = renderHook(() => useCalls({ token: 'jwt' }));
    await waitFor(() => expect(result.current.error).toBe('Failed to fetch'));

    await act(() => result.current.refetch());
    await waitFor(() => expect(result.current.calls).toHaveLength(3));
    expect(result.current.error).toBeNull();
  });
});

describe('useStats', () => {
  it('reads the dashboard summary', async () => {
    stubFetch({ '/api/calls/stats/summary': STATS_RESPONSE });
    const { result } = renderHook(() => useStats('jwt'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stats).toMatchObject({ total: 3, received: 2, missed: 1, recorded: 2 });
    expect(result.current.stats.latestMissed[0].call_id).toBe('BZ-2');
  });

  it('passes the date range through', async () => {
    const fetchMock = stubFetch({ '/api/calls/stats/summary': STATS_RESPONSE });
    renderHook(() => useStats('jwt', { dateFrom: '2026-08-01', dateTo: '2026-08-17' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const params = lastQuery(fetchMock);
    expect(params.get('dateFrom')).toBe('2026-08-01T00:00');
    expect(params.get('dateTo')).toBe('2026-08-17T23:59');
  });

  it('swallows a summary failure rather than breaking the dashboard', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('down'))));
    const { result } = renderHook(() => useStats('jwt'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.stats).toBeNull();
  });
});

describe('useDateRange', () => {
  it('derives the earliest selectable date from the oldest call', async () => {
    stubFetch({ '/api/calls/stats/summary': STATS_RESPONSE });
    const { result } = renderHook(() => useDateRange('jwt'));

    await waitFor(() => expect(result.current.minDate).toBeTruthy());
    expect(result.current.minDate).toMatch(/^2026-08-1[45]$/);   // local-time rendering of 15 Aug UTC
  });

  it('never sets a max date ceiling later than today', async () => {
    // A stale ceiling would hide calls that arrive while the page is open.
    stubFetch({ '/api/calls/stats/summary': STATS_RESPONSE });
    const { result } = renderHook(() => useDateRange('jwt'));

    const today = new Date();
    const pad = n => String(n).padStart(2, '0');
    expect(result.current.maxDate).toBe(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);
  });

  it('does not call the API without a token', () => {
    const fetchMock = stubFetch({ '/api/calls/stats/summary': STATS_RESPONSE });
    renderHook(() => useDateRange(null));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('click-to-call round trip', () => {
  it('posts the number, agent and originating call', async () => {
    const fetchMock = stubFetch({ '/api/calls/initiate': { status: 'Success' } });

    const res = await initiateCall('919876543210', '1001', 'jwt', 'BZ-2');

    expect(res).toEqual({ status: 'Success' });
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/calls/initiate');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      customer_number:  '919876543210',
      agent_number:     '1001',
      original_call_id: 'BZ-2',
    });
  });

  it('confirms once the BuzzDial webhook lands for that number', async () => {
    vi.useFakeTimers();
    let found = false;
    const fetchMock = stubFetch({ '/api/calls/click2call/check': () => ({ found }) });
    const onConfirmed = vi.fn();
    const onTimeout   = vi.fn();

    pollClick2Call('919876543210', Date.now(), 'jwt', { onConfirmed, onTimeout });

    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onConfirmed).not.toHaveBeenCalled();

    found = true;   // the webhook arrives
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();

    // Confirmed means stop polling.
    const callsSoFar = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).toHaveBeenCalledTimes(callsSoFar);
  });

  it('gives up after five minutes if no webhook arrives', async () => {
    vi.useFakeTimers();
    stubFetch({ '/api/calls/click2call/check': { found: false } });
    const onConfirmed = vi.fn();
    const onTimeout   = vi.fn();

    pollClick2Call('919876543210', Date.now(), 'jwt', { onConfirmed, onTimeout });

    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60 * 1000); });
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onConfirmed).not.toHaveBeenCalled();
  });

  it('keeps polling through a network blip', async () => {
    vi.useFakeTimers();
    let attempt = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('blip');
      return { ok: true, json: async () => ({ found: true }) };
    }));
    const onConfirmed = vi.fn();

    pollClick2Call('919876543210', Date.now(), 'jwt', { onConfirmed, onTimeout: vi.fn() });

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it('returns a cleanup function that halts polling', async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch({ '/api/calls/click2call/check': { found: false } });

    const stop = pollClick2Call('919876543210', Date.now(), 'jwt', { onConfirmed: vi.fn(), onTimeout: vi.fn() });
    stop();

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
