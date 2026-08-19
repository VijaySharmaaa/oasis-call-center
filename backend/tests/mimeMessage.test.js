/**
 * lib/mimeMessage — the reply we hand to Gmail.
 *
 * Gmail composes nothing for us: it takes a finished RFC 2822 message. So the
 * things that decide whether a reply lands in the candidate's existing thread,
 * and whether Hindi survives the trip, are all decided here.
 */
process.env.NODE_ENV = 'test';

const { buildReply, quoteOriginal, replySubject, encodeHeaderValue, formatAddress } = require('../src/lib/mimeMessage');

const FROM = { email: 'support@upessc.org', name: 'UPTET Support' };
const TO   = { email: 'aasha@example.com', name: 'Km Aasha' };

/** Decode what we would actually put on the wire. */
function decode(raw) {
  const text = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  const [headerBlock, ...rest] = text.split('\r\n\r\n');
  const headers = Object.fromEntries(
    headerBlock.split('\r\n').map(line => {
      const i = line.indexOf(': ');
      return [line.slice(0, i), line.slice(i + 2)];
    })
  );
  const body = Buffer.from(rest.join('\r\n\r\n').replace(/\r\n/g, ''), 'base64').toString('utf8');
  return { headers, body, text };
}

describe('the message we build', () => {
  const { raw } = buildReply({
    from: FROM, to: TO, subject: 'Payment debited but form incomplete',
    body: 'We have raised this with the payment team.',
  });
  const { headers, body } = decode(raw);

  it('addresses it from the mailbox to the candidate', () => {
    expect(headers.From).toBe('UPTET Support <support@upessc.org>');
    expect(headers.To).toBe('Km Aasha <aasha@example.com>');
  });

  it('prefixes the subject once', () => {
    expect(headers.Subject).toBe('Re: Payment debited but form incomplete');
  });

  it('declares an encoding that survives a round trip', () => {
    expect(headers['MIME-Version']).toBe('1.0');
    expect(headers['Content-Type']).toBe('text/plain; charset="UTF-8"');
    expect(headers['Content-Transfer-Encoding']).toBe('base64');
    expect(body).toBe('We have raised this with the payment team.');
  });

  it('encodes to base64url, which is what the raw field takes', () => {
    expect(raw).not.toMatch(/[+/=]/);
  });
});

describe('threading', () => {
  const { raw } = buildReply({
    from: FROM, to: TO, subject: 'Re: Fee debited twice', body: 'Refund issued.',
    inReplyTo: '<msg-3@mail.example.com>',
    references: ['<msg-1@mail.example.com>', '<msg-2@mail.example.com>', '<msg-3@mail.example.com>'],
  });
  const { headers } = decode(raw);

  it('answers the message it was given', () => {
    expect(headers['In-Reply-To']).toBe('<msg-3@mail.example.com>');
  });

  it('carries the whole chain in References, oldest first', () => {
    expect(headers.References).toBe('<msg-1@mail.example.com> <msg-2@mail.example.com> <msg-3@mail.example.com>');
  });

  it('does not repeat the answered message when it is already in the chain', () => {
    expect(headers.References.match(/msg-3/g)).toHaveLength(1);
  });

  it('adds the answered message to References when it is missing from it', () => {
    const { raw: r } = buildReply({
      from: FROM, to: TO, subject: 'x', body: 'y',
      inReplyTo: '<late@mail.example.com>', references: ['<first@mail.example.com>'],
    });
    expect(decode(r).headers.References).toBe('<first@mail.example.com> <late@mail.example.com>');
  });

  it('leaves both headers off a first message, rather than sending empty ones', () => {
    const { headers: h } = decode(buildReply({ from: FROM, to: TO, subject: 'x', body: 'y' }).raw);
    expect(h['In-Reply-To']).toBeUndefined();
    expect(h.References).toBeUndefined();
  });

  it('does not prefix a subject that is already a reply', () => {
    expect(replySubject('Re: already answered')).toBe('Re: already answered');
    expect(replySubject('RE: shouting')).toBe('RE: shouting');
    expect(replySubject('')).toBe('Re: (no subject)');
  });
});

describe('non-ASCII, which half this mailbox is', () => {
  it('carries a Devanagari body through unchanged', () => {
    const hindi = 'आपका आवेदन स्वीकार कर लिया गया है।';
    const { body } = decode(buildReply({ from: FROM, to: TO, subject: 'x', body: hindi }).raw);
    expect(body).toBe(hindi);
  });

  it('encodes a Devanagari subject as an RFC 2047 word', () => {
    const { headers } = decode(buildReply({ from: FROM, to: TO, subject: 'शुल्क वापसी', body: 'ok' }).raw);
    // The whole value is encoded, prefix included — permitted, and simpler than
    // splitting the "Re: " out. What matters is what it decodes back to.
    expect(headers.Subject).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    const encoded = headers.Subject.replace(/^=\?UTF-8\?B\?/, '').replace(/\?=$/, '');
    expect(Buffer.from(encoded, 'base64').toString('utf8')).toBe('Re: शुल्क वापसी');
  });

  it('encodes a non-ASCII display name', () => {
    expect(encodeHeaderValue('कुमारी आशा')).toMatch(/^=\?UTF-8\?B\?/);
    expect(encodeHeaderValue('plain')).toBe('plain');
  });

  it('wraps the base64 body at the line length the encoding requires', () => {
    const long = 'x'.repeat(5000);
    const { text } = decode(buildReply({ from: FROM, to: TO, subject: 'x', body: long }).raw);
    const bodyLines = text.split('\r\n\r\n').slice(1).join('').split('\r\n');
    for (const line of bodyLines) expect(line.length).toBeLessThanOrEqual(76);
  });
});

describe('addresses', () => {
  it('quotes a display name containing a comma, which would otherwise split it', () => {
    expect(formatAddress({ name: 'Doe, John', email: 'j@x.com' })).toBe('"Doe, John" <j@x.com>');
  });

  it('sends a bare address when there is no name', () => {
    expect(formatAddress({ email: 'j@x.com' })).toBe('j@x.com');
  });

  it('escapes a quote inside a name rather than ending the string early', () => {
    expect(formatAddress({ name: 'A "B" C', email: 'j@x.com' })).toBe('"A \\"B\\" C" <j@x.com>');
  });
});

describe('the quoted original', () => {
  const quote = {
    from_name: 'Km Aasha', from_email: 'aasha@example.com',
    received_at: new Date('2026-08-18T09:00:00Z'),
    body: 'Mera fee do baar cut gaya hai.',
  };

  it('writes the attribution line and quotes the body', () => {
    const out = quoteOriginal(quote);
    expect(out).toMatch(/^On .*Km Aasha <aasha@example\.com> wrote:$/m);
    expect(out).toContain('> Mera fee do baar cut gaya hai.');
  });

  it('appears under the reply, not over it', () => {
    const { body } = decode(buildReply({
      from: FROM, to: TO, subject: 'x', body: 'Refund issued.', quote,
    }).raw);
    expect(body.indexOf('Refund issued.')).toBeLessThan(body.indexOf('wrote:'));
  });

  it('is left out when there is nothing to quote', () => {
    expect(quoteOriginal({ ...quote, body: '' })).toBe('');
    const { body } = decode(buildReply({ from: FROM, to: TO, subject: 'x', body: 'y', quote: null }).raw);
    expect(body).toBe('y');
  });
});

describe('what it refuses', () => {
  it('will not send without a recipient', () => {
    expect(() => buildReply({ from: FROM, to: {}, subject: 'x', body: 'y' })).toThrow(/recipient/i);
  });

  it('will not send an empty body', () => {
    expect(() => buildReply({ from: FROM, to: TO, subject: 'x', body: '   ' })).toThrow(/body/i);
  });

  /* A newline in a header value ends the header and starts another — that is
     how a Bcc gets appended to somebody else's message. */
  it('strips newlines out of header values, so a header cannot be injected', () => {
    const { headers, text } = decode(buildReply({
      from: FROM, to: TO, body: 'y',
      subject: 'innocent\r\nBcc: attacker@evil.com',
      inReplyTo: '<id@x>\r\nX-Injected: yes',
    }).raw);

    expect(headers.Bcc).toBeUndefined();
    expect(headers['X-Injected']).toBeUndefined();
    expect(text).not.toMatch(/^Bcc:/m);
    expect(headers.Subject).toContain('innocent');
  });
});
