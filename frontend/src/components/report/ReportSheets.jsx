import { useMemo } from 'react';
import Sheet, { Rule, VRule, SheetHeader } from './Sheet';
import IssueList from './IssueList';
import IssuePie from './IssuePie';
import Timeline from './Timeline';
import FeedbackBars from './FeedbackBars';
import { buildCategoryColors, BORDER_COLOR } from '../../lib/reportPalette';
import { ddmmyyyy } from '../../lib/reportDate';

/**
 * The printed sheets, given a report.
 *
 * FIVE SHEETS FOR BOTH CHANNELS, THREE FOR ONE. Filtering to calls or mail does
 * not blank half the report — it removes those sections and renumbers, so a
 * calls-only report is overview, timeline, feedback, and nothing that would
 * invite the reader to wonder where the mail went. The API omits the excluded
 * channel entirely (null, not empty), so there is no zero to render by accident.
 *
 * Deliberately free of fetching and state: the page owns loading the data, this
 * owns rendering it. That split is what lets the layout be rendered from a
 * fixture — in tests and when checking printed geometry — with no API involved.
 */

/** A headline count with its label — the repeating stat of page 1. */
function Stat({ label, value, tone }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-2xl font-bold tabular-nums leading-none mt-0.5" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
    </div>
  );
}

/** A limit of the data the report must state rather than imply. */
function Caveat({ children }) {
  return (
    <p className="text-[9px] text-slate-500 italic mt-1 flex items-start gap-1">
      <span aria-hidden style={{ color: BORDER_COLOR }}>▲</span>
      <span>{children}</span>
    </p>
  );
}

/** The bucket-by-bucket figures behind the line, so the page carries values. */
function BucketTable({ buckets, colorOf, unit }) {
  const active = buckets.filter(b => b.count > 0);
  if (active.length === 0) return <p className="text-[10px] text-slate-400 italic">No traffic in this window.</p>;

  return (
    <table className="w-full text-[10px]">
      <thead>
        <tr className="text-slate-400 text-left uppercase tracking-wide">
          <th className="font-medium py-1 w-16">{unit}</th>
          <th className="font-medium py-1 w-14">Count</th>
          <th className="font-medium py-1">Dominant issue</th>
        </tr>
      </thead>
      <tbody>
        {active.map(b => (
          <tr key={b.key} className="border-t border-slate-100">
            <td className="py-0.5 tabular-nums text-slate-600">{b.label}</td>
            <td className="py-0.5 tabular-nums font-semibold text-slate-900">{b.count}</td>
            <td className="py-0.5">
              {b.topCategory ? (
                <span className="flex items-center gap-1.5">
                  <span data-category={b.topCategory} className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: colorOf(b.topCategory) }} />
                  <span className="text-slate-600">{b.topCategory}</span>
                </span>
              ) : (
                <span className="text-slate-400 italic">no issue identified</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ReportSheets({ report }) {
  // One colour map for the whole report, ranked from the window's issue share,
  // so a category keeps the same colour on every page.
  const { colorOf } = useMemo(
    () => buildCategoryColors(report?.issueShare || []),
    [report],
  );

  if (!report) return null;

  const hasCalls  = !!report.calls;
  const hasEmails = !!report.emails;

  // A single day prints as a date; a range prints as a span. The report is read
  // long after it is generated, so the window it covers is never implicit.
  const isRange = report.days > 1;
  const windowLabel = isRange
    ? `${ddmmyyyy(report.from)} – ${ddmmyyyy(report.to)}`
    : ddmmyyyy(report.from);
  const previousLabel = isRange
    ? `Previous ${report.days} days`
    : `Previous day ${ddmmyyyy(report.previousFrom)}`;
  const currentLabel = isRange ? `${report.days} days to ${ddmmyyyy(report.to)}` : `Today ${windowLabel}`;
  const unit = report.granularity === 'hour' ? 'Hour' : 'Day';

  // The sheets this report will actually emit, in order. Page numbers are read
  // off this list rather than counted during render, so a three-page report
  // reads 1-2-3 instead of keeping the gaps its missing channel would leave.
  const sheets = [
    'overview',
    ...(hasCalls  ? ['calls-timeline']  : []),
    ...(hasEmails ? ['emails-timeline'] : []),
    ...(hasCalls  ? ['calls-feedback']  : []),
    ...(hasEmails ? ['emails-feedback'] : []),
  ];
  const pageOf = id => sheets.indexOf(id) + 1;

  return (
    <div className="report-pages space-y-6 print:space-y-0">

      {/* ══ Overview ═════════════════════════════════════════════════════ */}
      <Sheet>
        <header className="flex items-baseline justify-between">
          <h1 className="text-xl font-bold tracking-tight uppercase" style={{ color: BORDER_COLOR }}>
            Overview
            {report.channel !== 'all' && (
              <span className="ml-2 text-[11px] font-semibold tracking-normal normal-case text-slate-500">
                {report.channel === 'calls' ? 'calls only' : 'mails only'}
              </span>
            )}
          </h1>
          <span className="text-sm font-semibold tabular-nums text-slate-700">{windowLabel}</span>
        </header>
        <Rule />

        {hasCalls && (
          <>
            {/* ── Calls: resolved ── */}
            <div className="flex gap-5">
              <div className="w-32 shrink-0">
                <Stat label="Calls resolved" value={report.calls.resolved.total} tone={BORDER_COLOR} />
                <div className="text-[9px] text-slate-400 mt-1">of {report.calls.answered} answered</div>
              </div>
              <div className="flex-1 min-w-0">
                <IssueList bucket={report.calls.resolved} colorOf={colorOf} categoryLimit={5} subLimit={2} />
              </div>
            </div>

            <Rule />

            {/* ── Calls: unresolved, with the missed count beside it ── */}
            <div className="flex gap-5">
              <div className="w-32 shrink-0">
                <Stat label="Calls unresolved" value={report.calls.unresolved.total} tone={BORDER_COLOR} />
                <div className="text-[9px] text-slate-400 mt-1">includes partial</div>
              </div>
              <div className="flex-1 min-w-0">
                <IssueList bucket={report.calls.unresolved} colorOf={colorOf} categoryLimit={5} subLimit={2} />
              </div>

              <VRule />

              {/* The template's "vertically small section listing missed calls" */}
              <div className="w-24 shrink-0 text-center">
                <Stat label="Missed" value={report.calls.missed} />
                <div className="text-[9px] text-slate-400 mt-1">never answered</div>
                {report.calls.pending > 0 && (
                  <div className="mt-2 pt-2 border-t border-slate-200">
                    <div className="text-[9px] uppercase tracking-wide text-slate-400">Pending AI</div>
                    <div className="text-sm font-semibold tabular-nums text-slate-600">{report.calls.pending}</div>
                  </div>
                )}
              </div>
            </div>

            <Rule />
          </>
        )}

        {hasEmails && (
          <>
            {/* ── Mail: replied & resolved ── */}
            <div className="flex gap-5">
              <div className="w-32 shrink-0">
                <Stat label="Mail replied + resolved" value={report.emails.repliedResolved.total} tone={BORDER_COLOR} />
                <div className="text-[9px] text-slate-400 mt-1">of {report.emails.total} received</div>
              </div>
              <div className="flex-1 min-w-0">
                <IssueList
                  bucket={report.emails.repliedResolved} colorOf={colorOf}
                  categoryLimit={hasCalls ? 4 : 5} subLimit={hasCalls ? 1 : 2} dense={hasCalls}
                />
              </div>
            </div>

            <Rule />

            {/* ── Mail: replied & unresolved | not replied ── */}
            <div className="flex gap-5">
              <div className="flex-1 min-w-0 flex gap-4">
                <div className="w-28 shrink-0">
                  <Stat label="Replied + unresolved" value={report.emails.repliedUnresolved.total} />
                </div>
                <div className="flex-1 min-w-0">
                  <IssueList
                    bucket={report.emails.repliedUnresolved} colorOf={colorOf}
                    categoryLimit={hasCalls ? 3 : 5} subLimit={1} dense
                  />
                </div>
              </div>

              <VRule />

              <div className="flex-1 min-w-0 flex gap-4">
                <div className="w-28 shrink-0">
                  <Stat label="Not replied" value={report.emails.notReplied.total} />
                </div>
                <div className="flex-1 min-w-0">
                  <IssueList
                    bucket={report.emails.notReplied} colorOf={colorOf}
                    categoryLimit={hasCalls ? 3 : 5} subLimit={1} dense
                  />
                </div>
              </div>
            </div>

            {report.caveats.sentMailVisible === false && (
              <Caveat>
                No sent mail is visible in the mailbox sync, so every message reads as
                unanswered. Widen <code>GMAIL_SYNC_QUERY</code> to include sent mail before
                these three buckets can mean anything.
              </Caveat>
            )}

            <Rule />
          </>
        )}

        {/* ── The pie ── */}
        <div>
          <h3 className="text-[10px] uppercase tracking-wide text-slate-400 mb-2">
            Share of issues raised · {report.issueMentions} mention{report.issueMentions === 1 ? '' : 's'}
            {report.channel === 'all' ? ' across calls and mail' : report.channel === 'calls' ? ' across calls' : ' across mail'}
          </h3>
          <IssuePie issueShare={report.issueShare} mentions={report.issueMentions} colorOf={colorOf} />
        </div>
      </Sheet>

      {/* ══ Call timeline ════════════════════════════════════════════════ */}
      {hasCalls && (
        <Sheet>
          <SheetHeader title="Timeline · Calls" date={windowLabel} page={pageOf('calls-timeline')} />
          <Rule />
          <Timeline
            current={report.timeline.calls.current}
            previous={report.timeline.calls.previous}
            granularity={report.granularity}
            colorOf={colorOf}
            label={currentLabel}
            previousLabel={previousLabel}
          />

          <Rule />
          <h3 className="text-[10px] uppercase tracking-wide text-slate-400 mb-2">
            {report.granularity === 'hour' ? 'Hour by hour' : 'Day by day'}
          </h3>
          <BucketTable buckets={report.timeline.calls.current} colorOf={colorOf} unit={unit} />
        </Sheet>
      )}

      {/* ══ Mail timeline ════════════════════════════════════════════════ */}
      {hasEmails && (
        <Sheet>
          <SheetHeader title="Timeline · Mails" date={windowLabel} page={pageOf('emails-timeline')} />
          <Rule />
          <Timeline
            current={report.timeline.emails.current}
            previous={report.timeline.emails.previous}
            granularity={report.granularity}
            colorOf={colorOf}
            label={currentLabel}
            previousLabel={previousLabel}
          />

          <Rule />
          <h3 className="text-[10px] uppercase tracking-wide text-slate-400 mb-2">
            {report.granularity === 'hour' ? 'Hour by hour' : 'Day by day'}
          </h3>
          <BucketTable buckets={report.timeline.emails.current} colorOf={colorOf} unit={unit} />
        </Sheet>
      )}

      {/* ══ Call feedback loop ═══════════════════════════════════════════ */}
      {hasCalls && (
        <Sheet>
          <SheetHeader title="Feedback loop · Calls" date={windowLabel} page={pageOf('calls-feedback')} />
          <Rule />
          <FeedbackBars
            rows={report.feedback.calls}
            colorOf={colorOf}
            secondLabel="Rectified on the call"
            secondKey="firstTouch"
            emptyNote="No analysed calls in this window."
          />
          <Caveat>
            Time to resolve is measured from linked tickets only
            ({report.caveats.callsWithTickets} call{report.caveats.callsWithTickets === 1 ? '' : 's'} raised one).
            A call settled without a ticket has no resolution timestamp to measure.
          </Caveat>
        </Sheet>
      )}

      {/* ══ Mail feedback loop ═══════════════════════════════════════════ */}
      {hasEmails && (
        <Sheet>
          <SheetHeader title="Feedback loop · Mails" date={windowLabel} page={pageOf('emails-feedback')} />
          <Rule />
          <FeedbackBars
            rows={report.feedback.emails}
            colorOf={colorOf}
            secondLabel="Follow-up mail sent"
            secondKey="followUp"
            secondAvailable={report.caveats.followUpMailTracked}
            emptyNote="No mail received in this window."
          />
          <Caveat>
            Time to resolve is measured from linked tickets only
            ({report.caveats.emailsWithTickets} mail{report.caveats.emailsWithTickets === 1 ? '' : 's'} raised one).
          </Caveat>
          {!report.caveats.followUpMailTracked && (
            <Caveat>
              Nothing in the system records that a follow-up mail was sent to a candidate
              raising a grievance, so that column reads as uncaptured rather than as zero.
              It needs a field on the mail before it can be reported.
            </Caveat>
          )}
        </Sheet>
      )}
    </div>
  );
}
