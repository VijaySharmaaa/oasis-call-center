/**
 * lib/emailText — reducing a raw body to what the person actually wrote.
 *
 * The fixture below is a real message from the support mailbox, kept verbatim
 * because every layer this module has to strip is in it at once: a wrapped
 * "On … wrote:" header, a "> " quoted copy of the whole previous mail, a
 * signature delimiter, a corporate disclaimer, and a sign-off. Rendered as-is
 * the same paragraph appears twice in one bubble.
 */
process.env.NODE_ENV  = 'test';
process.env.LOG_LEVEL = 'error';

const {
  cleanEmailBody, emailToPlainText, stripQuotedText, stripQuotedLines,
  stripSignature, stripDisclaimer, stripSignOff, htmlToText,
} = require('../src/lib/emailText');

const DISCLAIMER =
  'Disclaimer: This email and its attachments are confidential, intended \n' +
  'solely for the designated recipient(s). Unauthorized sharing, forwarding, \n' +
  'or disclosure is prohibited. If received in error, notify the sender \n' +
  'immediately and delete it. Email transmission may not be secure.';

const MESSAGE =
  'Hi [Recipient Name],\n' +
  '\n' +
  'I have completed the form, but I am unable to submit it. There is no error\n' +
  'message or notification appearing to indicate what the issue might be.\n' +
  '\n' +
  'Could you please assist me with this?';

/** The whole thing, exactly as Gmail delivered it. */
const RAW =
  MESSAGE + '\n' +
  '\n' +
  'Best regards,\n' +
  'Anshuman Mishra\n' +
  '\n' +
  '-- \n' +
  '\n' +
  '\n' +
  '\n' +
  '\n' +
  DISCLAIMER + '\n' +
  '\n' +
  'On Tue, 18 Aug 2026 at 21:15, Anshuman Mishra <\n' +
  'anshuman.mishra@innovatiview.in> wrote:\n' +
  '\n' +
  '> Hi [Recipient Name],\n' +
  '>\n' +
  '> I have completed the form, but I am unable to submit it. There is no error\n' +
  '> message or notification appearing to indicate what the issue might be.\n' +
  '>\n' +
  '> Could you please assist me with this?\n' +
  '>\n' +
  '> Best regards,\n' +
  '> Anshuman Mishra\n' +
  '>\n' +
  '> Disclaimer: This email and its attachments are confidential, intended\n' +
  '> solely for the designated recipient(s).\n' +
  '>\n';

describe('the message inside a real email', () => {
  const { text, trimmed } = cleanEmailBody(RAW);

  it('keeps every word the sender actually wrote', () => {
    expect(text).toContain('I have completed the form, but I am unable to submit it.');
    expect(text).toContain('Could you please assist me with this?');
    expect(text).toContain('Hi [Recipient Name],');
  });

  it('drops the quoted copy of the previous mail', () => {
    expect(text).not.toMatch(/^>/m);
    // The paragraph appears once, not twice.
    expect(text.match(/unable to submit it/g)).toHaveLength(1);
  });

  it('drops the "On … wrote:" header, wrapped across two lines as Gmail sends it', () => {
    expect(text).not.toContain('wrote:');
    expect(text).not.toContain('anshuman.mishra@innovatiview.in');
    expect(text).not.toContain('18 Aug 2026 at 21:15');
  });

  it('drops the corporate disclaimer', () => {
    expect(text).not.toMatch(/confidential/i);
    expect(text).not.toMatch(/Unauthorized sharing/i);
  });

  it('drops the sign-off, which the bubble already says', () => {
    expect(text).not.toContain('Best regards');
    expect(text).not.toContain('Anshuman Mishra');
  });

  it('leaves no run of blank lines behind', () => {
    expect(text).not.toMatch(/\n{3,}/);
    expect(text).toBe(text.trim());
  });

  it('reports that it edited the body, so the UI can offer the original', () => {
    expect(trimmed).toBe(true);
  });
});

describe('quoted history', () => {
  it('cuts a Gmail reply header', () => {
    const body = 'Mera OTR nahi khul raha\n\nOn Mon, Aug 17, 2026 at 2:00 PM Support wrote:\n> earlier reply';
    expect(stripQuotedText(body)).toBe('Mera OTR nahi khul raha');
  });

  it('cuts one wrapped across lines, which a single-line pattern misses', () => {
    const body = 'Please help\n\nOn Tue, 18 Aug 2026 at 21:15, Anshuman Mishra <\nanshuman@example.com> wrote:\n> old';
    expect(stripQuotedText(body)).toBe('Please help');
  });

  it('cuts an Outlook original-message block', () => {
    const body = 'Please correct my name.\n\n-----Original Message-----\nFrom: support\nOld text';
    expect(stripQuotedText(body)).toBe('Please correct my name.');
  });

  it('cuts a forwarded header block', () => {
    expect(stripQuotedText('See below\n\nFrom: someone@example.com\nSent: Monday')).toBe('See below');
  });

  it('keeps a bare forward, where the quote IS the message', () => {
    const body = 'On Mon, Aug 17, 2026 at 2:00 PM Support wrote:\n> my registration failed';
    expect(stripQuotedText(body)).toContain('registration failed');
  });

  it('keeps quoted lines when nothing else survives them', () => {
    expect(stripQuotedLines('> forwarded only\n> second line')).toContain('forwarded only');
  });

  it('leaves an ordinary email untouched', () => {
    expect(stripQuotedText('Simple request about my marksheet')).toBe('Simple request about my marksheet');
  });

  it('handles empty input', () => {
    expect(stripQuotedText('')).toBe('');
    expect(stripQuotedText(undefined)).toBe('');
  });
});

describe('signatures and disclaimers', () => {
  it('cuts everything below the "-- " delimiter', () => {
    expect(stripSignature('The message\n\n-- \nAnshuman\nSupport Desk').trim()).toBe('The message');
  });

  it('does not treat a line of dashes inside the text as a delimiter', () => {
    // Only an exactly-two-dash line counts, per the convention clients follow.
    expect(stripSignature('Before\n----\nAfter')).toContain('After');
  });

  it('cuts a disclaimer that arrives with no delimiter above it', () => {
    const body = 'Please reopen my form.\n\nDisclaimer: This email and its attachments are confidential.';
    expect(stripDisclaimer(body).trim()).toBe('Please reopen my form.');
  });

  it('cuts the other wordings mail servers use', () => {
    for (const opener of [
      'This email is confidential and intended solely for the addressee.',
      'CONFIDENTIALITY NOTICE: the contents are privileged.',
      'The information in this message is confidential.',
    ]) {
      expect(stripDisclaimer(`Real question here?\n\n${opener}`).trim()).toBe('Real question here?');
    }
  });

  it('keeps a message that is nothing but a disclaimer', () => {
    // An automated notice still has to render as something.
    const only = 'Disclaimer: This email and its attachments are confidential.';
    expect(cleanEmailBody(only).text).toContain('confidential');
  });
});

describe('sign-offs', () => {
  it('cuts a closing and the name under it', () => {
    expect(stripSignOff('My form will not open.\n\nBest regards,\nAnshuman Mishra').trim())
      .toBe('My form will not open.');
  });

  it('cuts the common variants', () => {
    for (const closing of ['Thanks,', 'Thank you', 'Regards', 'Kind regards,', 'Sincerely,', 'Cheers', 'Sent from my iPhone']) {
      expect(stripSignOff(`The actual question?\n\n${closing}\nRavi`).trim()).toBe('The actual question?');
    }
  });

  it('keeps a paragraph that merely starts with a closing word', () => {
    // "Thanks for the reply, but the form still does not open" is the message.
    const body = 'Hello\n\nThanks for the reply, but the form still does not open and I need it fixed today.';
    expect(stripSignOff(body)).toContain('still does not open');
  });

  it('keeps a message that is only a sign-off', () => {
    expect(cleanEmailBody('Thanks!').text).toBe('Thanks!');
  });
});

describe('the rule that overrides every heuristic', () => {
  it('never returns nothing for a body that had something', () => {
    const bodies = [
      '> only quoted text',
      '-- \nsignature only',
      'Disclaimer: confidential.',
      'Regards,\nRavi',
      'On Mon, Aug 17, 2026 at 2:00 PM Support wrote:\n> forwarded with no note',
    ];
    for (const body of bodies) expect(cleanEmailBody(body).text).not.toBe('');
  });

  it('reports an untouched body as untrimmed', () => {
    const plain = 'Sir mera fee do baar cut gaya hai.';
    expect(cleanEmailBody(plain)).toEqual({ text: plain, trimmed: false });
  });

  it('handles an empty body', () => {
    expect(cleanEmailBody('')).toEqual({ text: '', trimmed: false });
    expect(cleanEmailBody(undefined)).toEqual({ text: '', trimmed: false });
  });
});

describe('emailToPlainText', () => {
  it('prefers the plain-text part', () => {
    expect(emailToPlainText({ body_text: 'plain wins', body_html: '<p>html loses</p>' })).toBe('plain wins');
  });

  it('falls back to HTML when there is no usable text part', () => {
    expect(emailToPlainText({ body_text: '   ', body_html: '<p>from html</p>' })).toBe('from html');
  });

  it('cleans the HTML fallback too', () => {
    const html = '<p>My photo will not upload.</p><p>Regards,</p><p>Ravi</p><p>Disclaimer: This email is confidential.</p>';
    const text = emailToPlainText({ body_html: html });
    expect(text).toContain('photo will not upload');
    expect(text).not.toMatch(/confidential/i);
  });

  it('gives the analysis the same body the chat shows', () => {
    // The prompt and the bubble must not disagree about what was said.
    expect(emailToPlainText({ body_text: RAW })).toBe(cleanEmailBody(RAW).text);
  });

  it('returns an empty string for a body-less email', () => {
    expect(emailToPlainText({})).toBe('');
  });
});

describe('htmlToText', () => {
  it('converts block tags to line breaks and strips markup', () => {
    expect(htmlToText('<p>Payment <b>debited</b></p><div>form incomplete</div>')).toMatch(/Payment debited/);
    expect(htmlToText('<p>a</p><p>b</p>')).toContain('\n');
  });

  it('removes script and style content entirely', () => {
    const out = htmlToText('<style>.x{color:red}</style><script>alert(1)</script><p>real text</p>');
    expect(out).not.toMatch(/color:red|alert/);
    expect(out).toContain('real text');
  });

  it('decodes the common entities', () => {
    expect(htmlToText('<p>B.Ed &amp; D.El.Ed &lt;2026&gt; &quot;x&quot; &#39;y&#39;&nbsp;z</p>'))
      .toBe('B.Ed & D.El.Ed <2026> "x" \'y\' z');
  });
});
