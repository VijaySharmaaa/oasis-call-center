/**
 * The five report sheets.
 *
 * Renders the whole report from a fixture produced by the real backend
 * aggregation, so these assertions fail if either side of the contract moves.
 * The focus is on what a reader of the printed page relies on: that the
 * numbers shown are the numbers reported, that a category wears one colour
 * throughout, and that a gap in the data is stated rather than drawn as zero.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ReportSheets from '../components/report/ReportSheets';
import { ddmmyyyy } from '../lib/reportDate';
import { dailyReport, rangeReport, callsReport, emailsReport } from './fixtures/dailyReport';
import { CATEGORY_COLORS, OTHER_COLOR } from '../lib/reportPalette';
import { formatMoney } from '../lib/reportCost';

/** Deep clone, so a test that mutates the fixture cannot leak into the next. */
const clone   = r => JSON.parse(JSON.stringify(r));
const fixture = () => clone(dailyReport);

describe('ddmmyyyy', () => {
  it('prints the template date format', () => {
    expect(ddmmyyyy('2026-08-18')).toBe('18/08/2026');
  });

  it('is empty for a missing date rather than printing "undefined"', () => {
    expect(ddmmyyyy(null)).toBe('');
  });
});

describe('structure', () => {
  it('renders five sheets when both channels are in scope', () => {
    const { container } = render(<ReportSheets report={fixture()} />);
    expect(container.querySelectorAll('.report-sheet')).toHaveLength(5);
  });

  it('renders nothing at all without a report, rather than an empty shell', () => {
    const { container } = render(<ReportSheets report={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('heads page 1 with OVERVIEW and the date in DD/MM/YYYY', () => {
    render(<ReportSheets report={fixture()} />);
    expect(screen.getByRole('heading', { name: /overview/i })).toBeInTheDocument();
    expect(screen.getAllByText('18/08/2026').length).toBeGreaterThan(0);
  });
});

describe('page 1 — the numbers match the report', () => {
  it('prints the call buckets the API reported', () => {
    const report = fixture();
    const { container } = render(<ReportSheets report={report} />);
    const page1 = container.querySelectorAll('.report-sheet')[0];

    expect(within(page1).getByText(String(report.calls.resolved.total))).toBeInTheDocument();
    expect(within(page1).getByText(`of ${report.calls.answered} answered`)).toBeInTheDocument();
  });

  it('gives missed calls their own section', () => {
    const report = fixture();
    const { container } = render(<ReportSheets report={report} />);
    const page1 = container.querySelectorAll('.report-sheet')[0];

    expect(within(page1).getByText('Missed')).toBeInTheDocument();
    expect(within(page1).getByText('never answered')).toBeInTheDocument();
  });

  it('shows all three mail buckets', () => {
    const { container } = render(<ReportSheets report={fixture()} />);
    const page1 = container.querySelectorAll('.report-sheet')[0];

    expect(within(page1).getByText(/replied \+ resolved/i)).toBeInTheDocument();
    expect(within(page1).getByText(/replied \+ unresolved/i)).toBeInTheDocument();
    expect(within(page1).getByText(/not replied/i)).toBeInTheDocument();
  });

  it('surfaces the sent-mail caveat only when sent mail is invisible', () => {
    const visible = fixture();
    render(<ReportSheets report={visible} />);
    expect(screen.queryByText(/no sent mail is visible/i)).not.toBeInTheDocument();

    const blind = fixture();
    blind.caveats.sentMailVisible = false;
    render(<ReportSheets report={blind} />);
    expect(screen.getByText(/no sent mail is visible/i)).toBeInTheDocument();
  });
});

describe('page 1 — the pie', () => {
  it('never draws more than six slices, however long the tail', () => {
    const report = fixture();
    expect(report.issueShare.length).toBeGreaterThan(6);   // the fixture must exercise this

    const { container } = render(<ReportSheets report={report} />);
    const pie = container.querySelector('svg[aria-label*="issue mentions"]');
    expect(pie.querySelectorAll('path').length).toBeLessThanOrEqual(6);
  });

  it('labels every slice with its name and percentage — identity is never colour alone', () => {
    const report = fixture();
    const { container } = render(<ReportSheets report={report} />);
    const page1 = container.querySelectorAll('.report-sheet')[0];

    expect(within(page1).getAllByText(/%$/).length).toBeGreaterThanOrEqual(5);
    expect(within(page1).getAllByText(report.issueShare[0].category).length).toBeGreaterThan(0);
  });

  it('says how many categories it folded into Other', () => {
    const report = fixture();
    render(<ReportSheets report={report} />);
    const folded = report.issueShare.length - CATEGORY_COLORS.length;
    expect(screen.getByText(`(${folded} more)`)).toBeInTheDocument();
  });
});

describe('colour consistency across pages', () => {
  /**
   * The colour a swatch was actually painted, normalised to lowercase hex.
   * An SVG `fill` keeps the authored hex while jsdom rewrites a `style`
   * background to `rgb(...)`, so the two have to be compared in one form.
   */
  const paintOf = el => {
    const raw = el.getAttribute('fill')
      ?? el.getAttribute('style')?.match(/background:\s*([^;]+)/)?.[1]?.trim()
      ?? '';
    const rgb = raw.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (!rgb) return raw.toLowerCase();
    return '#' + rgb.slice(1).map(n => Number(n).toString(16).padStart(2, '0')).join('');
  };

  it('uses one colour per category across all five sheets', () => {
    const report = fixture();
    const { container } = render(<ReportSheets report={report} />);

    // Every category that got a swatch anywhere, and every colour it was given.
    const seen = new Map();
    for (const el of container.querySelectorAll('[data-category]')) {
      const category = el.getAttribute('data-category');
      if (!seen.has(category)) seen.set(category, new Set());
      seen.get(category).add(paintOf(el));
    }

    expect(seen.size).toBeGreaterThan(1);   // the fixture must actually exercise this
    for (const [category, colours] of seen) {
      expect(`${category}: ${[...colours].join(', ')}`).toBe(`${category}: ${[...colours][0]}`);
    }
  });

  it('appears on more than one sheet, so the consistency check means something', () => {
    const report = fixture();
    const { container } = render(<ReportSheets report={report} />);
    const sheetsWithSwatches = [...container.querySelectorAll('.report-sheet')]
      .filter(sheet => sheet.querySelector('[data-category]')).length;
    expect(sheetsWithSwatches).toBeGreaterThanOrEqual(4);
  });

  it('paints the top category with the first palette slot', () => {
    const report = fixture();
    const { container } = render(<ReportSheets report={report} />);
    const html = container.innerHTML;
    expect(html).toContain(CATEGORY_COLORS[0]);
    expect(html).toContain(OTHER_COLOR);   // the folded tail
  });
});

describe('pages 2-3 — timelines', () => {
  it('draws a line chart for calls and one for mail', () => {
    const { container } = render(<ReportSheets report={fixture()} />);
    expect(container.querySelectorAll('svg[aria-label*="Volume by"]')).toHaveLength(2);
  });

  it('always names both series, so the two lines are never colour-only', () => {
    render(<ReportSheets report={fixture()} />);
    expect(screen.getAllByText(/Today 18\/08\/2026/).length).toBe(2);
    expect(screen.getAllByText(/Previous day 17\/08\/2026/).length).toBe(2);
  });

  it('lists the hour-by-hour figures beneath each chart', () => {
    const report = fixture();
    const { container } = render(<ReportSheets report={report} />);
    const page2 = container.querySelectorAll('.report-sheet')[1];
    const rows = within(page2).getAllByRole('row');

    const active = report.timeline.calls.current.filter(h => h.count > 0).length;
    expect(rows.length).toBe(active + 1);   // + header
  });
});

describe('pages 4-5 — feedback loop', () => {
  it('shows the sample size behind every average, so a thin average is visible', () => {
    const report = fixture();
    const { container } = render(<ReportSheets report={report} />);
    const page4 = container.querySelectorAll('.report-sheet')[3];

    const withAverage = report.feedback.calls.filter(r => r.avgResolutionMins !== null);
    expect(withAverage.length).toBeGreaterThan(0);
    expect(within(page4).getAllByText(/from \d+ tickets?/).length).toBe(withAverage.length);
  });

  it('says "no resolved ticket" instead of drawing a zero bar', () => {
    const report = fixture();
    report.feedback.calls[0].avgResolutionMins = null;
    report.feedback.calls[0].resolvedCount = 0;

    const { container } = render(<ReportSheets report={report} />);
    const page4 = container.querySelectorAll('.report-sheet')[3];
    expect(within(page4).getAllByText('no resolved ticket').length).toBeGreaterThan(0);
  });

  it('marks follow-up mail as uncaptured rather than reporting zero', () => {
    const { container } = render(<ReportSheets report={fixture()} />);
    const page5 = container.querySelectorAll('.report-sheet')[4];

    expect(within(page5).getAllByText('not captured').length).toBeGreaterThan(0);
    expect(within(page5).getByText(/nothing in the system records/i)).toBeInTheDocument();
  });

  it('plots time and count as two separate charts, never one dual axis', () => {
    const { container } = render(<ReportSheets report={fixture()} />);
    const page4 = container.querySelectorAll('.report-sheet')[3];

    expect(within(page4).getByText(/avg time to resolve/i)).toBeInTheDocument();
    expect(within(page4).getByText(/rectified on the call/i)).toBeInTheDocument();
  });

  it('handles a day with no calls at all', () => {
    const report = fixture();
    report.feedback.calls = [];
    const { container } = render(<ReportSheets report={report} />);
    expect(within(container.querySelectorAll('.report-sheet')[3])
      .getByText('No analysed calls in this window.')).toBeInTheDocument();
  });
});

/** A full 24-hour spine with nothing in it. */
const emptySpine = () => Array.from({ length: 24 }, (_, h) => ({
  key: String(h).padStart(2, '0'), label: `${String(h).padStart(2, '0')}:00`,
  count: 0, topCategory: null,
}));

describe('an empty day still prints', () => {
  it('renders five sheets with zeroes rather than crashing', () => {
    const empty = {
      from: '2026-08-19', to: '2026-08-19', days: 1, channel: 'all', granularity: 'hour',
      previousFrom: '2026-08-18', previousTo: '2026-08-18', generatedAt: new Date().toISOString(),
      calls: { total: 0, answered: 0, missed: 0, pending: 0,
        resolved:   { total: 0, categories: [], mentions: 0, reserved: 0 },
        unresolved: { total: 0, categories: [], mentions: 0, reserved: 0 } },
      emails: { total: 0,
        repliedResolved:   { total: 0, categories: [], mentions: 0, reserved: 0 },
        repliedUnresolved: { total: 0, categories: [], mentions: 0, reserved: 0 },
        notReplied:        { total: 0, categories: [], mentions: 0, reserved: 0 } },
      issueShare: [], issueMentions: 0,
      timeline: {
        calls:  { current: emptySpine(), previous: emptySpine() },
        emails: { current: emptySpine(), previous: emptySpine() },
      },
      feedback: { calls: [], emails: [] },
      caveats: { sentMailVisible: false, followUpMailTracked: false, callsWithTickets: 0, emailsWithTickets: 0 },
    };

    const { container } = render(<ReportSheets report={empty} />);
    expect(container.querySelectorAll('.report-sheet')).toHaveLength(5);
    expect(screen.getByText(/no issues categorised/i)).toBeInTheDocument();
    expect(screen.getAllByText(/no traffic in either window/i).length).toBe(2);
  });
});

/* ── channel filter: three sheets, not five ────────────────────────────── */

describe('channel filter', () => {
  it('prints three sheets for calls only', () => {
    const { container } = render(<ReportSheets report={clone(callsReport)} />);
    expect(container.querySelectorAll('.report-sheet')).toHaveLength(3);
  });

  it('prints three sheets for mails only', () => {
    const { container } = render(<ReportSheets report={clone(emailsReport)} />);
    expect(container.querySelectorAll('.report-sheet')).toHaveLength(3);
  });

  it('removes every mail section from a calls-only report', () => {
    render(<ReportSheets report={clone(callsReport)} />);

    expect(screen.queryByText(/replied \+ resolved/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not replied/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Timeline · Mails/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Feedback loop · Mails/i)).not.toBeInTheDocument();
    // …while keeping every call section.
    expect(screen.getByText('Calls resolved')).toBeInTheDocument();
    expect(screen.getByText(/Timeline · Calls/i)).toBeInTheDocument();
    expect(screen.getByText(/Feedback loop · Calls/i)).toBeInTheDocument();
  });

  it('removes every call section from a mails-only report', () => {
    render(<ReportSheets report={clone(emailsReport)} />);

    expect(screen.queryByText('Calls resolved')).not.toBeInTheDocument();
    expect(screen.queryByText('Missed')).not.toBeInTheDocument();
    expect(screen.queryByText(/Timeline · Calls/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Feedback loop · Calls/i)).not.toBeInTheDocument();
    expect(screen.getByText(/replied \+ resolved/i)).toBeInTheDocument();
  });

  it('numbers three sheets 1-2-3, leaving no gap where a channel was dropped', () => {
    render(<ReportSheets report={clone(callsReport)} />);
    expect(screen.getByText(/page 2$/)).toBeInTheDocument();
    expect(screen.getByText(/page 3$/)).toBeInTheDocument();
    expect(screen.queryByText(/page 4$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/page 5$/)).not.toBeInTheDocument();
  });

  it('says on the page which channel it was filtered to', () => {
    render(<ReportSheets report={clone(callsReport)} />);
    expect(screen.getByText('calls only')).toBeInTheDocument();
  });

  it('carries no channel note when both channels are in scope', () => {
    render(<ReportSheets report={fixture()} />);
    expect(screen.queryByText('calls only')).not.toBeInTheDocument();
    expect(screen.queryByText('mails only')).not.toBeInTheDocument();
  });

  it('shares the pie across only the channel in scope', () => {
    render(<ReportSheets report={clone(callsReport)} />);
    expect(screen.getByText(/across calls$/)).toBeInTheDocument();
  });
});

/* ── date ranges ───────────────────────────────────────────────────────── */

describe('date ranges', () => {
  it('heads a range with the span, not a single date', () => {
    render(<ReportSheets report={clone(rangeReport)} />);
    expect(screen.getAllByText('17/08/2026 – 18/08/2026').length).toBeGreaterThan(0);
  });

  it('plots one point per day and labels the axis DD/MM', () => {
    const report = clone(rangeReport);
    const { container } = render(<ReportSheets report={report} />);
    const chart = container.querySelector('svg[aria-label*="Volume by day"]');

    expect(chart).toBeInTheDocument();
    expect(report.timeline.calls.current).toHaveLength(2);
    expect(within(chart).getByText('17/08')).toBeInTheDocument();
  });

  it('names the comparison window by its length rather than a date', () => {
    render(<ReportSheets report={clone(rangeReport)} />);
    expect(screen.getAllByText(/Previous 2 days/).length).toBe(2);
  });

  it('switches the bucket table heading from hours to days', () => {
    render(<ReportSheets report={clone(rangeReport)} />);
    expect(screen.getAllByText('Day by day').length).toBe(2);
    expect(screen.queryByText('Hour by hour')).not.toBeInTheDocument();
  });

  it('still reads hour by hour for a single day', () => {
    render(<ReportSheets report={fixture()} />);
    expect(screen.getAllByText('Hour by hour').length).toBe(2);
  });
});

/* ── gemini cost ───────────────────────────────────────────────────────── */

describe('gemini cost', () => {
  it('prints the window total on the overview sheet', () => {
    const report = fixture();
    const { container } = render(<ReportSheets report={report} />);
    const page1 = container.querySelectorAll('.report-sheet')[0];

    expect(within(page1).getByText('Gemini analysis cost')).toBeInTheDocument();
    expect(report.cost.total.usd).toBeGreaterThan(0);
    // Asserted through the formatter rather than a hardcoded shape, so this
    // test checks that the total is rendered, not how many decimals it takes.
    const shown = formatMoney(report.cost.total.usd, { code: report.cost.currency, perUsd: report.cost.perUsd });
    expect(within(page1).getByText(shown)).toBeInTheDocument();
  });

  it('splits the total between calls and mail when both are in scope', () => {
    const { container } = render(<ReportSheets report={fixture()} />);
    const page1 = container.querySelectorAll('.report-sheet')[0];

    expect(within(page1).getByText('Calls')).toBeInTheDocument();
    expect(within(page1).getByText('Mails')).toBeInTheDocument();
  });

  it('drops the split on a single-channel report, where it would say nothing', () => {
    const { container } = render(<ReportSheets report={clone(callsReport)} />);
    const page1 = container.querySelectorAll('.report-sheet')[0];

    expect(within(page1).getByText('Gemini analysis cost')).toBeInTheDocument();
    expect(within(page1).queryByText('Mails')).not.toBeInTheDocument();
  });

  it('states how many analyses could not be priced', () => {
    const report = fixture();
    expect(report.cost.total.unpriced).toBeGreaterThan(0);   // the fixture must exercise this

    render(<ReportSheets report={report} />);
    expect(screen.getByText(new RegExp(`${report.cost.total.unpriced} analyses could not be`, 'i')))
      .toBeInTheDocument();
  });

  it('says nothing about unpriced analyses when everything was priced', () => {
    const report = fixture();
    report.cost.total.unpriced = 0;
    render(<ReportSheets report={report} />);
    expect(screen.queryByText(/could not be\s*priced/i)).not.toBeInTheDocument();
  });

  it('prints the rate card, so a stale rate is visible on the page', () => {
    render(<ReportSheets report={fixture()} />);
    expect(screen.getByText(/Rates \(USD per 1M tokens\)/)).toBeInTheDocument();
    expect(screen.getByText(/2\.5-flash 0\.3\/1a\/2\.5o/)).toBeInTheDocument();
  });

  it('gives every timeline bucket its own cost column', () => {
    const report = fixture();
    const { container } = render(<ReportSheets report={report} />);
    const page2 = container.querySelectorAll('.report-sheet')[1];

    expect(within(page2).getByText('AI cost')).toBeInTheDocument();
    // The per-bucket costs must sum to the channel total.
    const summed = report.timeline.calls.current.reduce((a, b) => a + b.costUsd, 0);
    expect(summed).toBeCloseTo(report.cost.calls.usd, 4);
  });

  it('carries per-day cost on a range report', () => {
    const report = clone(rangeReport);
    const { container } = render(<ReportSheets report={report} />);
    const page2 = container.querySelectorAll('.report-sheet')[1];

    expect(within(page2).getByText('AI cost')).toBeInTheDocument();
    expect(report.timeline.calls.current.every(b => typeof b.costUsd === 'number')).toBe(true);
    const summed = report.timeline.calls.current.reduce((a, b) => a + b.costUsd, 0);
    expect(summed).toBeCloseTo(report.cost.calls.usd, 4);
  });

  it('renders without a cost block at all for an older report shape', () => {
    const report = fixture();
    delete report.cost;
    const { container } = render(<ReportSheets report={report} />);
    expect(container.querySelectorAll('.report-sheet')).toHaveLength(5);
    expect(screen.queryByText('Gemini analysis cost')).not.toBeInTheDocument();
  });
});
