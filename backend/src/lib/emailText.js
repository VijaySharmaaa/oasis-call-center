/**
 * What a person actually wrote.
 *
 * A support email is mostly not the message. A three-line request arrives
 * wrapped in a sign-off, a corporate disclaimer nobody has ever read, the whole
 * previous exchange re-quoted with "> " in front of it, and the header line
 * naming who wrote what when. Rendered verbatim in a chat bubble that is
 * unreadable — the same paragraph appears three times down one conversation —
 * and sent verbatim to Gemini it is tokens spent on boilerplate.
 *
 * So both readers go through here. The chat shows the message; the prompt
 * carries the message; the untouched original is always one click away through
 * the per-message endpoint, which is what makes trimming safe rather than lossy.
 *
 * THE ONE RULE THAT OVERRIDES EVERY HEURISTIC BELOW: never return nothing. A
 * bare forward with no covering note IS the content, and a candidate who writes
 * only "Best regards" has still told us something. Every step that would empty
 * the body falls back to what it was given.
 */

/** Normalise line endings so every pattern below can assume \n. */
function normalise(text) {
  return String(text || '').replace(/\r\n?/g, '\n');
}

/**
 * The header a mail client writes above a quoted reply.
 *
 * Gmail wraps this line when the address is long — "On Tue, 18 Aug 2026 at
 * 21:15, Anshuman Mishra <\nanshuman.mishra@example.com> wrote:" is one marker
 * across two lines. A pattern anchored with `.` never matches that, which is
 * why the whole quoted thread used to survive into the bubble.
 */
const QUOTE_MARKERS = [
  /^[ \t]*On\b[\s\S]{0,300}?\bwrote:[ \t]*$/m,          // Gmail / Apple Mail, wrapped or not
  /^[ \t]*-{2,}[ \t]*Original Message[ \t]*-{2,}[ \t]*$/im, // Outlook
  /^[ \t]*_{10,}[ \t]*$/m,                               // Outlook divider
  /^[ \t]*From:[ \t]\S.*$/im,                            // forwarded header block
  /^[ \t]*-{3,}[ \t]*Forwarded message[ \s\S]{0,40}?$/im, // Gmail forward
  /^[ \t]*(?:El|Le|Am)\b.{0,200}?\bescribió:[ \t]*$/im,   // Spanish clients
];

/**
 * Where the quoted history starts, or -1.
 *
 * A marker with nothing above it is ignored: candidates routinely forward a
 * thread without writing a covering line, and there the quote is the message.
 */
function quoteCutIndex(text) {
  let cut = -1;
  for (const re of QUOTE_MARKERS) {
    const m = text.match(re);
    if (!m || m.index === undefined) continue;
    if (!text.slice(0, m.index).trim()) continue;
    if (cut === -1 || m.index < cut) cut = m.index;
  }
  return cut;
}

/**
 * Drop the quoted history and everything after it.
 * Kept under its original name because the analysis path has always called it.
 */
function stripQuotedText(body) {
  if (!body) return '';
  const text = normalise(body);
  const cut = quoteCutIndex(text);
  const kept = cut === -1 ? text : text.slice(0, cut);
  return kept.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Lines a client prefixed with ">" are somebody else's words. Only dropped when
 * something unquoted survives — a message that is nothing but quoted lines is a
 * forward, and forwards are content.
 */
function stripQuotedLines(text) {
  const lines = text.split('\n');
  const kept = lines.filter(line => !/^[ \t]*>/.test(line));
  return kept.some(line => line.trim()) ? kept.join('\n') : text;
}

/**
 * The signature delimiter: a line of exactly "--" or "-- ", by convention
 * (RFC 3676 §4.3) everything below it is the signature. Cutting here usually
 * takes the disclaimer with it, since that is where clients staple it.
 */
function stripSignature(text) {
  const m = text.match(/^-{2}[ \t]*$/m);
  if (!m || m.index === undefined) return text;
  if (!text.slice(0, m.index).trim()) return text;
  return text.slice(0, m.index);
}

/**
 * The legal boilerplate every corporate mail server staples on, with or without
 * a signature delimiter above it. Matched on the opener only — the body of one
 * of these runs for a paragraph and varies with the lawyer.
 */
const DISCLAIMER_OPENERS = [
  /^[ \t]*(?:\*|_)*\s*Disclaimer\s*[:\-—]/im,
  /^[ \t]*(?:\*|_)*\s*(?:Confidentiality|Legal|Privacy)\s+(?:Notice|Statement|Disclaimer)\b/im,
  /^[ \t]*This (?:e-?mail|message)[^\n]{0,120}\b(?:is|are|and any attachments?)\b[^\n]{0,200}\bconfidential\b/im,
  /^[ \t]*The (?:information|contents?) (?:in|of) this (?:e-?mail|message)[^\n]{0,200}\bconfidential\b/im,
  /^[ \t]*IMPORTANT[ \t]*[:\-][^\n]{0,80}\bconfidential\b/im,
];

function stripDisclaimer(text) {
  let cut = -1;
  for (const re of DISCLAIMER_OPENERS) {
    const m = text.match(re);
    if (!m || m.index === undefined) continue;
    // Never let the disclaimer eat the whole message: an automated notice that
    // IS nothing but legal text still has to render as something.
    if (!text.slice(0, m.index).trim()) continue;
    if (cut === -1 || m.index < cut) cut = m.index;
  }
  return cut === -1 ? text : text.slice(0, cut);
}

/** Closings that end a message rather than say anything in it. */
const SIGN_OFFS = new RegExp(
  '^[ \\t]*(?:' +
  'thanks?(?: (?:you|a lot|in advance|and regards))?|' +
  '(?:best|kind|warm|my)? ?regards|regards|' +
  'sincerely(?: yours)?|yours (?:sincerely|faithfully|truly)|' +
  'cheers|respectfully|dhanyavaad|shukriya|' +
  'sent from my \\w+' +
  ')[ \\t]*[,.!]*[ \\t]*$',
  'i'
);

/**
 * Trim a trailing "Best regards, / Anshuman Mishra".
 *
 * Deliberately narrow: only at the very end, only a recognised closing, and
 * only a couple of short lines after it — which is a name, a phone number, a
 * job title. The bubble already shows who is speaking, so the block says
 * nothing the chat has not said. Anything longer is left alone, because at that
 * point it is a message rather than a sign-off.
 */
function stripSignOff(text) {
  const lines = text.split('\n');
  let end = lines.length;
  while (end > 0 && !lines[end - 1].trim()) end -= 1;   // ignore trailing blanks

  const MAX_TRAILING_LINES = 3;
  for (let i = Math.max(0, end - 1 - MAX_TRAILING_LINES); i < end; i++) {
    if (!SIGN_OFFS.test(lines[i])) continue;

    const after = lines.slice(i + 1, end).filter(l => l.trim());
    // A name is short. A paragraph after "Regards" is the message continuing.
    if (after.some(l => l.trim().length > 60)) continue;
    // Something has to survive: a message that is only a sign-off is kept whole.
    if (!lines.slice(0, i).some(l => l.trim())) continue;

    return lines.slice(0, i).join('\n');
  }
  return text;
}

/** Collapse the runs of blank lines every step above leaves behind. */
function tidy(text) {
  return text
    .split('\n')
    .map(line => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Reduce a raw body to the message inside it.
 *
 * @param {string} raw
 * @returns {{text: string, trimmed: boolean}} `trimmed` says whether anything
 *          was removed, so the UI can offer the original rather than hiding
 *          that it edited what the sender wrote.
 */
function cleanEmailBody(raw) {
  const original = tidy(normalise(raw));
  if (!original) return { text: '', trimmed: false };

  let text = original;
  for (const step of [stripQuotedText, stripQuotedLines, stripSignature, stripDisclaimer, stripSignOff]) {
    const next = tidy(step(text));
    // The rule: a step that empties the body has misread it, so it is skipped.
    if (next) text = next;
  }

  return { text, trimmed: text !== original };
}

/** Very rough HTML → text, for mail that carries no text/plain part. */
function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The raw readable text of an email, preferring the plain-text part. */
function rawEmailText(email = {}) {
  return (email.body_text && email.body_text.trim())
    ? normalise(email.body_text)
    : htmlToText(normalise(email.body_html));
}

/**
 * The message an email carries, cleaned. Used by the analysis prompt and by the
 * worker's "is there anything here at all" check.
 */
function emailToPlainText(email = {}) {
  return cleanEmailBody(rawEmailText(email)).text;
}

module.exports = {
  cleanEmailBody,
  emailToPlainText,
  rawEmailText,
  htmlToText,
  stripQuotedText,
  stripQuotedLines,
  stripSignature,
  stripDisclaimer,
  stripSignOff,
};
