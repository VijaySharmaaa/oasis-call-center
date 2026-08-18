import { formatMoney, formatTokens } from '../../lib/reportCost';
import { BORDER_COLOR } from '../../lib/reportPalette';

/**
 * What the AI analysis of this window cost.
 *
 * The headline is a floor, not a bill: analyses whose spend could not be
 * established — no token counts recorded, or a model with no rate — are
 * counted and shown beside the figure rather than quietly omitted. A cost
 * report that rounds the unknown to zero is the one kind of error a reader
 * cannot catch, so it is stated on the page.
 *
 * The rate card is printed for the same reason. Google changes Gemini pricing;
 * a total computed from a stale rate should be traceable to the rate that
 * produced it, on the sheet, months later.
 */
export default function CostSummary({ cost, channel }) {
  if (!cost) return null;

  const currency = { code: cost.currency, perUsd: cost.perUsd };
  const showSplit = channel === 'all' && cost.calls && cost.emails;
  const tokens = {
    prompt: (cost.calls?.tokens.prompt ?? 0) + (cost.emails?.tokens.prompt ?? 0),
    output: (cost.calls?.tokens.output ?? 0) + (cost.emails?.tokens.output ?? 0),
    audio:  (cost.calls?.tokens.audio  ?? 0) + (cost.emails?.tokens.audio  ?? 0),
  };

  return (
    <div>
      <h3 className="text-[10px] uppercase tracking-wide text-slate-400 mb-2">
        Gemini analysis cost
      </h3>

      <div className="flex items-start gap-5">
        <div className="shrink-0">
          <div className="text-2xl font-bold tabular-nums leading-none" style={{ color: BORDER_COLOR }}>
            {formatMoney(cost.total.usd, currency)}
          </div>
          <div className="text-[9px] text-slate-400 mt-1">
            {cost.total.priced} analys{cost.total.priced === 1 ? 'is' : 'es'} priced
          </div>
        </div>

        {showSplit && (
          <div className="flex gap-5 shrink-0">
            <div>
              <div className="text-[9px] uppercase tracking-wide text-slate-400">Calls</div>
              <div className="text-sm font-semibold tabular-nums text-slate-800">
                {formatMoney(cost.calls.usd, currency)}
              </div>
              <div className="text-[9px] text-slate-400">{cost.calls.priced} priced</div>
            </div>
            <div>
              <div className="text-[9px] uppercase tracking-wide text-slate-400">Mails</div>
              <div className="text-sm font-semibold tabular-nums text-slate-800">
                {formatMoney(cost.emails.usd, currency)}
              </div>
              <div className="text-[9px] text-slate-400">{cost.emails.priced} priced</div>
            </div>
          </div>
        )}

        <div className="text-[9px] text-slate-500 leading-relaxed min-w-0">
          <div>
            Tokens: {formatTokens(tokens.prompt)} in
            {tokens.audio > 0 && <> ({formatTokens(tokens.audio)} audio)</>}
            {' · '}{formatTokens(tokens.output)} out
          </div>
          <div className="text-slate-400 mt-0.5">
            Rates (USD per 1M tokens):{' '}
            {Object.entries(cost.rates).map(([model, r], i) => (
              <span key={model}>
                {i > 0 && '; '}
                {model.replace(/^gemini-/, '')} {r.text}/{r.audio}a/{r.output}o
              </span>
            ))}
          </div>
        </div>
      </div>

      {cost.total.unpriced > 0 && (
        <p className="text-[9px] text-slate-500 italic mt-1 flex items-start gap-1">
          <span aria-hidden style={{ color: BORDER_COLOR }}>▲</span>
          <span>
            {cost.total.unpriced} analys{cost.total.unpriced === 1 ? 'is' : 'es'} could not be
            priced — no token counts recorded, or a model with no rate. Spend was
            higher than the figure above by that much; token capture began when
            cost reporting was added, so anything analysed before then is unpriced.
          </span>
        </p>
      )}
    </div>
  );
}
