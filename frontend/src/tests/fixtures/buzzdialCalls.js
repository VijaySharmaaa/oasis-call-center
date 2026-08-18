/**
 * Calls exactly as GET /api/calls returns them — the payload that starts life
 * as a BuzzDial webhook hit.
 *
 * Kept in step with backend/tests/calls.routes.test.js on purpose: the two
 * suites are the two halves of the same contract, so a field renamed on one
 * side should break the other.
 */

/** Answered call, recorded, AI-categorised. */
export const ANSWERED_CALL = {
  id:                'id-answered',
  call_id:           'BZ-1',
  caller_number:     '919876543210',
  called_number:     '918037126236',
  agent_number:      '1001',
  agent_name:        'Ravi Kumar',
  call_start_time:   '2026-08-17 14:30:00',
  agent_answer_time: '2026-08-17 14:30:08',
  call_end_time:     '2026-08-17 14:34:12',
  duration:          252,
  agent_duration:    244,
  keypress:          '2',
  call_recording:    'https://recordings.buzzdial.io/BZ-1.wav',
  category:          'Payment & Fee',
  sub_category:      'Duplicate Payment Refund Query',
  created_at:        '2026-08-17T14:34:12.000Z',
};

/** Missed call — empty agent_answer_time is how BuzzDial signals it. */
export const MISSED_CALL = {
  id:                'id-missed',
  call_id:           'BZ-2',
  caller_number:     '919812345678',
  called_number:     '918037126236',
  agent_number:      '',
  agent_name:        '',
  call_start_time:   '2026-08-17 12:00:00',
  agent_answer_time: '',
  call_end_time:     '2026-08-17 12:00:20',
  duration:          20,
  agent_duration:    0,
  keypress:          '1',
  call_recording:    '',
  created_at:        '2026-08-17T12:00:20.000Z',
};

/** Click-to-call leg: the caller is the BuzzDial system number. */
export const C2C_CALL = {
  id:                'id-c2c',
  call_id:           'BZ-3',
  caller_number:     '8037126236',   // SYSTEM_NUMBER in CallsTable
  called_number:     '919800000003',
  agent_number:      '1002',
  agent_name:        'Sunita Devi',
  call_start_time:   '2026-08-16 09:00:00',
  agent_answer_time: '2026-08-16 09:00:04',
  call_end_time:     '2026-08-16 09:02:00',
  duration:          116,
  agent_duration:    110,
  keypress:          '',
  call_recording:    'https://recordings.buzzdial.io/BZ-3.wav',
  source:            'click2call',
  created_at:        '2026-08-16T09:02:00.000Z',
};

export const CALLS_RESPONSE = {
  calls: [ANSWERED_CALL, MISSED_CALL, C2C_CALL],
  total: 3,
};

/** Shape of GET /api/calls/stats/summary that the dashboard reads. */
export const STATS_RESPONSE = {
  total: 3, received: 2, missed: 1, recorded: 2, today: 2,
  avgDuration: 129, avgAgentDuration: 118,
  latestMissed: [MISSED_CALL],
  todayByAgent: [{ agent_number: '1001', agent_name: 'Ravi Kumar', verified: true, count: 1 }],
  avgDurationByAgent: [{ agent_number: '1001', agent_name: 'Ravi Kumar', verified: true, avgDuration: 252 }],
  categoryBreakdown: [{ category: 'Payment & Fee', total: 1, subs: [{ sub_category: 'Duplicate Payment Refund Query', count: 1 }] }],
  categoryInsights: {}, topBugs: [],
  minDate: '2026-08-15T08:00:00.000Z',
  maxDate: '2026-08-17T14:34:12.000Z',
};

/** Stub global.fetch with a URL → payload router. */
export function stubFetch(routes) {
  const fetchMock = vi.fn(async (url) => {
    const href = String(url);
    const match = Object.keys(routes).find(key => href.includes(key));
    if (!match) throw new Error(`stubFetch: no route registered for ${href}`);
    const value = routes[match];
    const body  = typeof value === 'function' ? await value(href) : value;
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
