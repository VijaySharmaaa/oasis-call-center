/**
 * gmailService — credential detection and MIME parsing.
 *
 * Everything here is offline: no token is ever requested and no Gmail endpoint
 * is contacted. The live auth path is covered by the delegation check in
 * docs/gmail-integration.md, which needs real Workspace consent to pass.
 */
const gmail = require('../src/services/gmailService');

/** A structurally valid key — enough for detection, never used to sign. */
function fakeKey(overrides = {}) {
  return {
    type:         'service_account',
    project_id:   'test-project',
    client_id:    '123456789',
    client_email: 'fake@test-project.iam.gserviceaccount.com',
    private_key:  '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
    token_uri:    'https://oauth2.googleapis.com/token',
    ...overrides,
  };
}

/** Re-require the module with a fresh env — the key is memoised on first read. */
function withEnv(env, fn) {
  const saved = { ...process.env };
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('GMAIL_') || key.startsWith('GOOGLE_SERVICE_ACCOUNT')) delete process.env[key];
  }
  Object.assign(process.env, env);
  let result;
  jest.isolateModules(() => { result = fn(require('../src/services/gmailService')); });
  process.env = saved;
  return result;
}

function b64(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

describe('credential detection', () => {
  it('reports not configured when nothing is set', () => {
    withEnv({}, svc => {
      expect(svc.isConfigured()).toBe(false);
      expect(svc.authMode()).toBeNull();
    });
  });

  it('accepts a base64-encoded service account key', () => {
    withEnv({ GMAIL_USER: 'support@upessc.org', GOOGLE_SERVICE_ACCOUNT_KEY: b64(fakeKey()) }, svc => {
      expect(svc.authMode()).toBe('service_account');
      expect(svc.mailbox()).toBe('support@upessc.org');
    });
  });

  it('accepts raw single-line JSON just as well', () => {
    withEnv({ GMAIL_USER: 'support@upessc.org', GOOGLE_SERVICE_ACCOUNT_KEY: JSON.stringify(fakeKey()) }, svc => {
      expect(svc.authMode()).toBe('service_account');
    });
  });

  it('reads the key from GOOGLE_SERVICE_ACCOUNT_KEY_FILE', () => {
    const fs   = require('fs');
    const os   = require('os');
    const path = require('path');
    const file = path.join(os.tmpdir(), `oasis-sa-${process.pid}.json`);
    fs.writeFileSync(file, JSON.stringify(fakeKey()));
    try {
      withEnv({ GMAIL_USER: 'support@upessc.org', GOOGLE_SERVICE_ACCOUNT_KEY_FILE: file }, svc => {
        expect(svc.authMode()).toBe('service_account');
      });
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('ignores a service account key with no mailbox to impersonate', () => {
    // Delegation is meaningless without a subject, so this must not count as
    // configured — otherwise the worker would start and fail every tick.
    withEnv({ GOOGLE_SERVICE_ACCOUNT_KEY: b64(fakeKey()) }, svc => {
      expect(svc.authMode()).toBeNull();
      expect(svc.isConfigured()).toBe(false);
    });
  });

  it('rejects a malformed key instead of throwing at call time', () => {
    withEnv({ GMAIL_USER: 'support@upessc.org', GOOGLE_SERVICE_ACCOUNT_KEY: 'not-json-or-base64-{{{' }, svc => {
      expect(svc.authMode()).toBeNull();
    });
  });

  it('rejects a key missing private_key', () => {
    const incomplete = fakeKey();
    delete incomplete.private_key;
    withEnv({ GMAIL_USER: 'support@upessc.org', GOOGLE_SERVICE_ACCOUNT_KEY: b64(incomplete) }, svc => {
      expect(svc.authMode()).toBeNull();
    });
  });

  it('falls back to OAuth when only the OAuth trio is present', () => {
    withEnv({
      GMAIL_OAUTH_CLIENT_ID:     'cid',
      GMAIL_OAUTH_CLIENT_SECRET: 'secret',
      GMAIL_OAUTH_REFRESH_TOKEN: 'refresh',
    }, svc => {
      expect(svc.authMode()).toBe('oauth');
    });
  });

  it('prefers the service account when both are configured', () => {
    withEnv({
      GMAIL_USER: 'support@upessc.org',
      GOOGLE_SERVICE_ACCOUNT_KEY: b64(fakeKey()),
      GMAIL_OAUTH_CLIENT_ID:     'cid',
      GMAIL_OAUTH_CLIENT_SECRET: 'secret',
      GMAIL_OAUTH_REFRESH_TOKEN: 'refresh',
    }, svc => {
      expect(svc.authMode()).toBe('service_account');
    });
  });

  it('throws a pointed error when asked for a token with no credentials', async () => {
    await withEnv({}, async svc => {
      await expect(svc.getAccessToken()).rejects.toThrow(/not configured/i);
    });
  });
});

describe('parseAddress', () => {
  it.each([
    ['UPESSC Support <support@upessc.org>', { name: 'UPESSC Support', email: 'support@upessc.org' }],
    ['"Km Aasha" <aasha@example.com>',      { name: 'Km Aasha',       email: 'aasha@example.com' }],
    ['bare@example.com',                    { name: '',               email: 'bare@example.com' }],
    ['Mixed CASE <A.B@Example.COM>',        { name: 'Mixed CASE',     email: 'a.b@example.com' }],
    ['',                                    { name: '',               email: '' }],
    [undefined,                             { name: '',               email: '' }],
  ])('parses %p', (input, expected) => {
    expect(gmail.parseAddress(input)).toEqual(expected);
  });
});

describe('parseMessage', () => {
  const encode = str => Buffer.from(str, 'utf8').toString('base64url');

  function message(overrides = {}) {
    return {
      id: 'abc123',
      threadId: 'thread1',
      historyId: '99',
      internalDate: '1755338400000',
      snippet: 'OTR issue',
      sizeEstimate: 4242,
      labelIds: ['INBOX', 'UNREAD', 'Label_7'],
      payload: {
        mimeType: 'multipart/mixed',
        headers: [
          { name: 'Subject',    value: 'Appearing option missing' },
          { name: 'From',       value: 'Km Aasha <aasha@example.com>' },
          { name: 'To',         value: 'support@upessc.org' },
          { name: 'Message-ID', value: '<x@mail>' },
        ],
        parts: [
          { mimeType: 'multipart/alternative', parts: [
            { mimeType: 'text/plain', body: { data: encode('मेरा OTR नहीं खुल रहा') } },
            { mimeType: 'text/html',  body: { data: encode('<p>hi</p>') } },
          ]},
          { mimeType: 'application/pdf', filename: 'marksheet.pdf', body: { attachmentId: 'att1', size: 1024 } },
        ],
      },
      ...overrides,
    };
  }

  it('pulls headers, bodies and attachments out of a nested MIME tree', () => {
    const parsed = gmail.parseMessage(message());

    expect(parsed).toMatchObject({
      gmail_id:   'abc123',
      thread_id:  'thread1',
      subject:    'Appearing option missing',
      from_name:  'Km Aasha',
      from_email: 'aasha@example.com',
      to:         'support@upessc.org',
      rfc822_id:  '<x@mail>',
      body_text:  'मेरा OTR नहीं खुल रहा',   // UTF-8 survives base64url round-trip
      body_html:  '<p>hi</p>',
      has_attachments: true,
      size_estimate:   4242,
    });
    expect(parsed.attachments).toEqual([
      { attachment_id: 'att1', filename: 'marksheet.pdf', mime_type: 'application/pdf', size: 1024 },
    ]);
  });

  it('derives boolean flags from label ids', () => {
    expect(gmail.parseMessage(message())).toMatchObject({
      is_unread: true, in_inbox: true, is_starred: false, is_trashed: false, is_spam: false,
    });
    expect(gmail.parseMessage(message({ labelIds: ['TRASH', 'STARRED'] }))).toMatchObject({
      is_unread: false, in_inbox: false, is_starred: true, is_trashed: true,
    });
  });

  it('prefers internalDate over the sender-supplied Date header', () => {
    const msg = message();
    msg.payload.headers.push({ name: 'Date', value: 'Tue, 1 Jan 1980 00:00:00 +0000' });
    expect(gmail.parseMessage(msg).received_at.getTime()).toBe(1755338400000);
  });

  it('falls back to the Date header when internalDate is absent', () => {
    const msg = message({ internalDate: undefined });
    msg.payload.headers.push({ name: 'Date', value: 'Tue, 1 Jan 1980 00:00:00 +0000' });
    expect(gmail.parseMessage(msg).received_at.toISOString()).toBe('1980-01-01T00:00:00.000Z');
  });

  it('handles a bare single-part message with no parts array', () => {
    const parsed = gmail.parseMessage({
      id: 'plain1', threadId: 't', internalDate: '1755338400000', labelIds: [],
      payload: {
        mimeType: 'text/plain',
        headers: [{ name: 'From', value: 'a@b.com' }],
        body: { data: encode('just text') },
      },
    });
    expect(parsed.body_text).toBe('just text');
    expect(parsed.body_html).toBe('');
    expect(parsed.attachments).toEqual([]);
    expect(parsed.subject).toBe('(no subject)');
  });

  it('survives a message with no payload at all', () => {
    const parsed = gmail.parseMessage({ id: 'empty', threadId: 't', labelIds: [] });
    expect(parsed.gmail_id).toBe('empty');
    expect(parsed.body_text).toBe('');
    expect(parsed.received_at).toBeInstanceOf(Date);
  });

  it('truncates a body past GMAIL_MAX_BODY_CHARS so Mongo cannot reject the doc', () => {
    withEnv({ GMAIL_MAX_BODY_CHARS: '1000' }, svc => {
      const huge = 'x'.repeat(50_000);
      const parsed = svc.parseMessage({
        id: 'big', threadId: 't', internalDate: '1755338400000', labelIds: [],
        payload: { mimeType: 'text/plain', headers: [], body: { data: encode(huge) } },
      });
      expect(parsed.body_text.length).toBeLessThan(1200);
      expect(parsed.body_text).toMatch(/truncated by Oasis/);
    });
  });
});
