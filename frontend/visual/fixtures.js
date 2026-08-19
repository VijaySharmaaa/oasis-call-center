/**
 * A whole portal's worth of plausible data, and the two tricks that let a
 * browser render it without a backend.
 *
 * WHY NOT JUST RUN THE REAL STACK
 * A screenshot is only useful if it looks the same tomorrow. Pointed at Atlas,
 * these pages would change with whatever mail arrived overnight, and any visual
 * comparison would drown in that noise. Pointed at fixtures they are stable, so
 * a difference between two runs is a difference in the CODE.
 *
 * THE TWO TRICKS
 *   auth   AuthContext restores a session from localStorage and only *decodes*
 *          the JWT to read `exp` — it never verifies a signature, because that
 *          is the server's job. So an unsigned token with a future expiry is
 *          enough to render the portal as a logged-in admin.
 *   api    Every request under /api is fulfilled from the table below. Anything
 *          not listed returns an empty object rather than failing, so a page
 *          that grows a new endpoint degrades to an empty panel instead of a
 *          blank screen with a console full of red.
 */

/** base64url of a JSON object, which is all a JWT segment is. */
function segment(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** An unsigned token that expires a year out. Never leaves the test browser. */
export function fakeToken() {
  const exp = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  return `${segment({ alg: 'none', typ: 'JWT' })}.${segment({ name: 'Admin', role: 'admin', exp })}.unsigned`;
}

export const ADMIN = { name: 'Admin', role: 'admin', agent_number: null };

const AGENTS = [
  { agent_number: '1001', name: 'Ravi Kumar',   station: 'Lucknow',  active: true },
  { agent_number: '1002', name: 'Km Aasha',     station: 'Kanpur',   active: true },
  { agent_number: '1003', name: 'Suresh Yadav', station: 'Varanasi', active: false },
];

const CALLS = [
  { call_id: 'BZ-2201', caller_number: '919876543210', agent_number: '1001', agent_name: 'Ravi Kumar',
    call_start_time: '2026-08-19T09:14:00Z', agent_answer_time: '2026-08-19T09:14:08Z',
    call_end_time: '2026-08-19T09:19:30Z', duration: 330, agent_duration: 322,
    category: 'Payment & Fee', sub_category: 'Duplicate Payment Refund Query',
    tags: [{ category: 'Payment & Fee', sub_category: 'Duplicate Payment Refund Query' }],
    ai_insight: 'Duplicate payment refund request', call_recording: 'https://example.invalid/a.mp3',
    created_at: '2026-08-19T09:14:00Z', queue_status: 'completed', awaiting_analysis: false },
  { call_id: 'BZ-2202', caller_number: '919812345678', agent_number: '1002', agent_name: 'Km Aasha',
    call_start_time: '2026-08-19T10:02:00Z', agent_answer_time: '2026-08-19T10:02:05Z',
    call_end_time: '2026-08-19T10:06:10Z', duration: 250, agent_duration: 245,
    category: 'Portal Access & Registration', sub_category: 'Fresh Registration Query',
    tags: [{ category: 'Portal Access & Registration', sub_category: 'Fresh Registration Query' }],
    ai_insight: 'Cannot open registration form',
    created_at: '2026-08-19T10:02:00Z', queue_status: 'processing', awaiting_analysis: true },
  { call_id: 'BZ-2203', caller_number: '919900112233', agent_number: null, agent_name: null,
    call_start_time: '2026-08-19T11:20:00Z', call_end_time: '2026-08-19T11:20:40Z', duration: 40,
    created_at: '2026-08-19T11:20:00Z', queue_status: null, awaiting_analysis: false },
];

const CONVERSATIONS = [
  { id: 'aasha@example.com', participant_email: 'aasha@example.com', participant_name: 'Km Aasha',
    last_subject: 'Payment reference', last_inbound_snippet: 'Transaction ref 4471xx hai.',
    message_count: 3, inbound_count: 2, outbound_count: 1, unread_count: 2,
    first_message_at: '2026-08-17T10:00:00Z', last_message_at: '2026-08-18T09:00:00Z',
    has_attachments: true, category: 'Payment & Fee', sub_category: 'Duplicate Payment Refund Query',
    tags: [{ category: 'Payment & Fee', sub_category: 'Duplicate Payment Refund Query' }],
    ai_insight: 'Duplicate payment refund request', analysed_at: '2026-08-18T09:05:00Z',
    analysis_status: 'completed', needs_analysis: false, queue_status: 'completed', awaiting_analysis: false,
    is_resolved: true },
  { id: 'ravi@example.com', participant_email: 'ravi@example.com', participant_name: 'Ravi Sharma',
    last_subject: 'OTR edit query', last_inbound_snippet: 'How do I edit my saved data?',
    message_count: 1, inbound_count: 1, outbound_count: 0, unread_count: 0,
    first_message_at: '2026-08-15T10:00:00Z', last_message_at: '2026-08-15T10:00:00Z',
    has_attachments: false, needs_analysis: true, queue_status: 'pending', awaiting_analysis: true,
    is_resolved: false },
  { id: 'meena@example.com', participant_email: 'meena@example.com', participant_name: 'Meena Devi',
    last_subject: 'Photo upload failing', last_inbound_snippet: 'Photo upload nahi ho raha.',
    message_count: 5, inbound_count: 3, outbound_count: 2, unread_count: 0,
    first_message_at: '2026-08-12T08:00:00Z', last_message_at: '2026-08-19T07:30:00Z',
    has_attachments: true, category: 'Document & Photo Upload', sub_category: 'Photo Upload Failure',
    tags: [{ category: 'Document & Photo Upload', sub_category: 'Photo Upload Failure' },
           { category: 'Identity Verification', sub_category: 'Aadhaar OTP Not Received' }],
    ai_insight: 'Photo upload failing repeatedly', analysed_at: '2026-08-19T07:35:00Z',
    analysis_status: 'completed', needs_analysis: false, queue_status: 'completed', awaiting_analysis: false },
];

const CONVERSATION_DETAIL = {
  ...CONVERSATIONS[0],
  messages: [
    { id: 'm1', direction: 'inbound', subject: 'Fee debited twice', from_name: 'Km Aasha',
      from_email: 'aasha@example.com', received_at: '2026-08-17T10:00:00Z',
      body_text: 'Sir mera fee do baar cut gaya hai lekin form submit nahi hua. Please ek payment refund kar dijiye.',
      attachments: [], body_truncated: false, body_trimmed: true, has_html: true, is_unread: false },
    { id: 'm2', direction: 'outbound', subject: 'Re: Fee debited twice', from_name: 'UPTET Support',
      from_email: 'support@upessc.org', received_at: '2026-08-17T13:00:00Z',
      body_text: 'Please share the transaction reference so we can trace the payment.',
      attachments: [], body_truncated: false, body_trimmed: false, has_html: false, is_unread: false },
    { id: 'm3', direction: 'inbound', subject: 'Payment reference', from_name: 'Km Aasha',
      from_email: 'aasha@example.com', received_at: '2026-08-18T09:00:00Z',
      body_text: 'Transaction ref 4471xx hai. Ab tak refund nahi aaya, please dekh lijiye.',
      attachments: [{ attachment_id: 'att1', filename: 'receipt.pdf', size: 91_000 }],
      body_truncated: false, body_trimmed: true, has_html: true, is_unread: false },
  ],
  analysis: {
    status: 'completed', category: 'Payment & Fee',
    tags: [{ category: 'Payment & Fee', sub_category: 'Duplicate Payment Refund Query' }],
    ai_insight: 'Duplicate payment refund request',
    summary: 'The fee was debited twice for one application. They ask for one payment to be refunded and quote transaction ref 4471xx.',
    bugs: '-', bug_category: '-', requested_action: 'Refund', language: ['Hinglish'],
    message_count: 3, model_used: 'gemini-2.5-flash', processed_at: '2026-08-18T09:05:00Z',
  },
};

const TICKETS = [
  { _id: 't1', ticket_number: 'TKT-0007', title: 'Refund not received', status: 'Open', priority: 'High',
    source: 'email', customer_name: 'Km Aasha', customer_email: 'aasha@example.com',
    category: 'Billing', created_at: '2026-08-18T09:10:00Z', updated_at: '2026-08-18T09:10:00Z' },
  { _id: 't2', ticket_number: 'TKT-0006', title: 'Photo upload fails on submit', status: 'In Progress',
    priority: 'Urgent', source: 'call', customer_name: 'Meena Devi', customer_number: '919900112233',
    category: 'Technical Issue', created_at: '2026-08-17T12:00:00Z', updated_at: '2026-08-19T08:00:00Z' },
  { _id: 't3', ticket_number: 'TKT-0005', title: 'Wrong exam centre allotted', status: 'Resolved',
    priority: 'Medium', source: 'call', customer_name: 'Ravi Sharma', customer_number: '919812345678',
    category: 'General Inquiry', created_at: '2026-08-14T07:00:00Z', updated_at: '2026-08-16T11:00:00Z' },
];

const CATEGORY_SCHEMA = [
  { name: 'Payment & Fee', sub_categories: ['Duplicate Payment Refund Query', 'Fee Not Updated'] },
  { name: 'Portal Access & Registration', sub_categories: ['Fresh Registration Query'] },
  { name: 'Document & Photo Upload', sub_categories: ['Photo Upload Failure'] },
  { name: 'Identity Verification', sub_categories: ['Aadhaar OTP Not Received'] },
];

/**
 * url fragment → JSON body. First match wins, so put the specific paths above
 * the general ones.
 */
const ROUTES = [
  // Ahead of the conversation route below, which would otherwise swallow it:
  // `includes('/api/emails/conversations/aasha')` matches the .../read URL too,
  // and answering a mark-read with the whole conversation left the chat header
  // still claiming "2 unread" in the screenshot.
  ['/read',                                 { success: true, read: true, unread_count: 0 }],
  ['/api/emails/conversations/export/jobs', { job_id: 'job1', status: 'pending' }],
  ['/api/emails/conversations/aasha',       CONVERSATION_DETAIL],
  ['/api/emails/conversations',             { conversations: CONVERSATIONS, total: 3, unreadCount: 1 }],
  ['/api/emails/analysis/stats',            { queue: { pending: 1, processing: 0, completed: 12, failed: 0 },
                                              coverage: { stored: 14, analysed: 12, remaining: 2 },
                                              topBugs: [{ category: 'Payment Gateway', count: 4 }] }],
  ['/api/emails/categories',                { schema: CATEGORY_SCHEMA, counts: [
                                              { category: 'Payment & Fee', total: 7, subs: [{ sub_category: 'Duplicate Payment Refund Query', count: 5 }] },
                                              { category: 'Document & Photo Upload', total: 3, subs: [] }] }],
  ['/api/emails/sync-status',               { configured: true, auth_mode: 'service_account', mailbox: 'support@upessc.org',
                                              can_send: true, can_modify: true, phase: 'incremental',
                                              last_sync_at: '2026-08-19T11:00:00Z', last_error: null,
                                              synced_total: 214, stored_total: 214, unread: 2 }],
  ['/api/emails',                           { emails: [], total: 0, unreadCount: 0 }],

  ['/api/calls/stats',                      { total: 214, answered: 190, missed: 24, avgDuration: 268,
                                              answeredPct: 89, byHour: [], byAgent: [],
                                              received: 190, recorded: 176,
                                              categoryBreakdown: [
                                                { category: 'Payment & Fee', total: 46, subs: [] },
                                                { category: 'Educational Qualifications', total: 31, subs: [] },
                                                { category: 'Document & Photo Upload', total: 18, subs: [] }],
                                              // Seven categories against a whole of 214: enough tail to put the
                                              // grey `Other` residual on screen next to the five named wedges.
                                              topBugs: [
                                                { category: 'Payment Gateway', count: 62 },
                                                { category: 'OTP Not Received', count: 41 },
                                                { category: 'Document Upload Fails', count: 29 },
                                                { category: 'Form Validation', count: 21 },
                                                { category: 'Slow Page Load', count: 16 },
                                                { category: 'Session Timeout', count: 11 },
                                                { category: 'Print Layout', count: 9 }],
                                              topBugsTotal: 214 }],
  ['/api/calls/date-range',                 { minDate: '2026-07-01', maxDate: '2026-08-19' }],
  ['/api/calls/analysis/stats',             { queue: { pending: 2, processing: 1, completed: 180, failed: 1 },
                                              coverage: { stored: 214, analysed: 180, remaining: 34 } }],
  ['/api/calls',                            { calls: CALLS, total: 3 }],

  ['/api/agents',                           { agents: AGENTS, total: 3 }],
  ['/api/stations',                         { stations: [
                                              { _id: 's1', name: 'Lucknow', code: 'LKO', agents: 12, active: true },
                                              { _id: 's2', name: 'Kanpur', code: 'KNP', agents: 8, active: true }], total: 2 }],
  ['/api/tickets/stats',                    { Open: 4, 'In Progress': 2, Resolved: 9, Closed: 3 }],
  ['/api/tickets',                          { tickets: TICKETS, total: 3 }],
  ['/api/analysis',                         { rows: [], total: 0, analyses: [] }],
  ['/api/reports',                          { reports: [], total: 0 }],
  ['/api/auth/me',                          { user: ADMIN }],
];

/**
 * Point the page at the fixtures above.
 *
 * Anything unmatched resolves to `{}` with a 200: a page missing one panel is
 * still worth looking at, and a hard failure here would cost the screenshot of
 * everything else on it.
 */
export async function mockApi(page) {
  await page.route('**/api/**', async route => {
    const url = route.request().url();
    const hit = ROUTES.find(([fragment]) => url.includes(fragment));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(hit ? hit[1] : {}),
    });
  });
}

/** Put a logged-in admin session in place before the app boots. */
export async function signIn(page, baseURL) {
  await page.addInitScript(({ token, user }) => {
    localStorage.setItem('otr_auth', JSON.stringify({ token, user, mustChangePassword: false }));
  }, { token: fakeToken(), user: ADMIN });
  // addInitScript only applies to documents loaded after it is registered, so
  // the caller navigates next rather than relying on whatever is on screen now.
  return baseURL;
}
