import { useState } from "react";
import { initiateCall } from "../hooks/useCalls";
import { useAuth } from "../contexts/AuthContext";

export default function InitiateCallModal({
  onClose,
  onSuccess,
  defaultAgentNumber = "",
}) {
  const { token } = useAuth();
  const isAgentLocked = !!defaultAgentNumber;
  const [customerNumber, setCustomerNumber] = useState("");
  const [agentNumber, setAgentNumber] = useState(defaultAgentNumber);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const isSuccess =
    result && (result.status === "Success" || result.status === "success");

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const res = await initiateCall(customerNumber, agentNumber, token);
      setResult(res);
      if (res.status === "Success" || res.status === "success") {
        onSuccess?.();
      }
    } catch {
      setResult({ status: "error", message: "Cannot connect to server" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-zinc-900 border border-slate-200 dark:border-zinc-700 rounded-2xl w-full max-w-md p-6 transition-colors"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Initiate Call
          </h2>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 dark:text-zinc-400 hover:bg-red-500/80 hover:text-white transition-colors"
          >
            <svg
              className="w-4 h-4"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-500 dark:text-zinc-400 mb-1">
              Customer Number *
            </label>
            <input
              type="tel"
              value={customerNumber}
              onChange={(e) => setCustomerNumber(e.target.value)}
              placeholder="e.g. 9999999999"
              required
              autoFocus
              className="w-full bg-slate-50 dark:bg-zinc-800 border border-slate-300 dark:border-zinc-700 rounded-lg px-3 py-2 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 dark:text-zinc-400 mb-1">
              Agent Number *
            </label>
            <input
              type="tel"
              value={agentNumber}
              onChange={
                isAgentLocked
                  ? undefined
                  : (e) => setAgentNumber(e.target.value)
              }
              readOnly={isAgentLocked}
              placeholder="e.g. 9999999999"
              className={`w-full border rounded-lg px-3 py-2 text-sm transition-colors focus:outline-none ${
                isAgentLocked
                  ? "bg-slate-100 dark:bg-zinc-800/50 border-slate-200 dark:border-zinc-700 text-slate-500 dark:text-zinc-400 cursor-not-allowed select-none"
                  : "bg-slate-50 dark:bg-zinc-800 border-slate-300 dark:border-zinc-700 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:border-indigo-500"
              }`}
            />
            {isAgentLocked && (
              <p className="mt-1 text-xs text-slate-400 dark:text-zinc-500">
                Your agent number is used automatically.
              </p>
            )}
          </div>

          {result && (
            <div
              className={`flex items-start gap-2.5 p-3 rounded-lg text-sm border ${
                isSuccess
                  ? "bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                  : "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800"
              }`}
            >
              {isSuccess ? (
                <svg
                  className="w-4 h-4 shrink-0 mt-0.5"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="8" cy="8" r="6" />
                  <path d="M5 8l2.5 2.5L11 5.5" />
                </svg>
              ) : (
                <svg
                  className="w-4 h-4 shrink-0 mt-0.5"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="8" cy="8" r="6" />
                  <path d="M8 5v3M8 11h.01" />
                </svg>
              )}
              <span>
                {result.message ||
                  (isSuccess
                    ? "Call initiated successfully"
                    : "Failed to initiate call")}
              </span>
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-slate-300 dark:border-zinc-700 text-slate-600 dark:text-zinc-300 hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
            >
              {isSuccess ? "Close" : "Cancel"}
            </button>
            {!isSuccess && (
              <button
                type="submit"
                disabled={loading || !customerNumber}
                className="flex-1 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg
                      className="w-4 h-4 animate-spin"
                      viewBox="0 0 16 16"
                      fill="none"
                    >
                      <circle
                        cx="8"
                        cy="8"
                        r="6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeDasharray="28"
                        strokeDashoffset="10"
                      />
                    </svg>
                    Calling…
                  </span>
                ) : (
                  "Call Now"
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
