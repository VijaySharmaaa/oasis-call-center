/**
 * Building the reply we hand to Gmail.
 *
 * Gmail's send endpoint takes a complete RFC 2822 message, base64url encoded —
 * it does not compose anything for us. Everything that makes a reply behave
 * like a reply is therefore our job:
 *
 *   threading   `In-Reply-To` and `References` are what a mail client threads
 *               on. Passing Gmail a threadId alone puts the message in the
 *               right thread OUR side and leaves it orphaned in the
 *               candidate's inbox, which is where it matters.
 *   encoding    Candidates write in Hindi and are answered in it. A raw 8-bit
 *               body is not legal in a header-bearing message and arrives as
 *               mojibake, so the body goes out base64 with an explicit charset
 *               and non-ASCII headers use RFC 2047 encoded-words.
 *   quoting     The previous message is quoted underneath, the way every mail
 *               client does it, because the candidate reading the reply has no
 *               Oasis to look the thread up in.
 */

/** Base64url, which is what Gmail's `raw` field expects. */
function base64url(buffer) {
  return Buffer.from(buffer).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * RFC 2047 encoded-word for a header that is not plain ASCII — a Devanagari
 * subject line reaches the recipient as mojibake without it.
 */
function encodeHeaderValue(value) {
  const text = String(value || '');
  if (!text) return '';
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  return `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

/**
 * A display name in an address needs quoting when it carries anything the
 * grammar treats as a separator — a comma most of all, since "Doe, John" splits
 * one recipient into two.
 */
function formatAddress({ name, email }) {
  if (!email) return '';
  if (!name) return email;
  const encoded = encodeHeaderValue(name);
  const needsQuotes = /[",:;<>@[\]\\]/.test(encoded);
  return `${needsQuotes ? `"${encoded.replace(/(["\\])/g, '\\$1')}"` : encoded} <${email}>`;
}

/** Headers must not carry bare newlines — that is how a header gets injected. */
function sanitizeHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

/** "Re: x" once, not "Re: Re: Re: x" down a long chain. */
function replySubject(subject) {
  const base = sanitizeHeader(subject) || '(no subject)';
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

/**
 * The attribution line and quoted body a mail client writes under a reply.
 * Our own chat strips this back off when it renders the thread (lib/emailText),
 * so it costs the operator nothing and gives the candidate the context.
 */
function quoteOriginal({ from_name, from_email, received_at, body }) {
  const text = String(body || '').replace(/\r\n?/g, '\n').trim();
  if (!text) return '';

  const who = from_name ? `${from_name} <${from_email || ''}>` : (from_email || 'the sender');
  const when = received_at ? new Date(received_at).toUTCString() : 'an earlier message';
  const quoted = text.split('\n').map(line => `> ${line}`).join('\n');
  return `On ${when}, ${who} wrote:\n${quoted}`;
}

/**
 * Build the reply.
 *
 * @param {object} opts
 * @param {{name?: string, email: string}} opts.from       the support mailbox
 * @param {{name?: string, email: string}} opts.to         the candidate
 * @param {string}  opts.subject                            already "Re:"-prefixed or not
 * @param {string}  opts.body                               what the operator typed
 * @param {string} [opts.inReplyTo]   the RFC822 Message-ID being answered
 * @param {string[]} [opts.references] the chain's Message-IDs, oldest first
 * @param {object} [opts.quote]       { from_name, from_email, received_at, body }
 * @param {string} [opts.replyTo]     Reply-To, when answers should go elsewhere
 * @returns {{raw: string, headers: object, body: string}}
 */
function buildReply({ from, to, subject, body, inReplyTo, references = [], quote, replyTo }) {
  if (!to?.email) throw new Error('A reply needs a recipient');
  if (!String(body || '').trim()) throw new Error('A reply needs a body');

  const quoted = quote ? quoteOriginal(quote) : '';
  const fullBody = [String(body).replace(/\r\n?/g, '\n').trim(), quoted]
    .filter(Boolean)
    .join('\n\n');

  // References is the whole chain; In-Reply-To is the one message being
  // answered. Clients thread on either, and disagreeing between them is how a
  // reply ends up in its own thread.
  const referenceList = [...new Set([...references, inReplyTo].filter(Boolean))];

  const headers = {
    'From': formatAddress(from),
    'To': formatAddress(to),
    ...(replyTo ? { 'Reply-To': sanitizeHeader(replyTo) } : {}),
    'Subject': encodeHeaderValue(replySubject(subject)),
    ...(inReplyTo ? { 'In-Reply-To': sanitizeHeader(inReplyTo) } : {}),
    ...(referenceList.length ? { 'References': referenceList.map(sanitizeHeader).join(' ') } : {}),
    'MIME-Version': '1.0',
    'Content-Type': 'text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding': 'base64',
  };

  // CRLF between headers and in the blank line that ends them, per the spec.
  const headerBlock = Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}`)
    .join('\r\n');

  // Base64 bodies are wrapped at 76 characters, which is the line-length limit
  // the transfer encoding exists to respect.
  const encodedBody = Buffer.from(fullBody, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');

  return {
    raw: base64url(`${headerBlock}\r\n\r\n${encodedBody}`),
    headers,
    body: fullBody,
  };
}

module.exports = {
  buildReply,
  quoteOriginal,
  replySubject,
  encodeHeaderValue,
  formatAddress,
  base64url,
};
