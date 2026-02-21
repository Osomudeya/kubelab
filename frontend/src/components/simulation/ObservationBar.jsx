/**
 * ObservationBar — "Watch your terminal" countdown and "I saw it — show explanation" button.
 * Shown during the observation window before WhatYouLearned.
 * observePrompt: optional prompt from sim data (e.g. "Before reading the explanation — what changed about the pod's name?")
 */

export default function ObservationBar({ countdown, onReveal, observePrompt, totalSeconds = 12 }) {
  if (countdown == null) return null;
  const pct = totalSeconds > 0 ? Math.max(0, (countdown / totalSeconds) * 100) : 0;
  return (
    <div className="mb-4 rounded-lg border-2 border-amber-300 bg-amber-50 p-4" aria-live="polite" aria-atomic="true">
      <p className="text-sm font-semibold text-amber-900 mb-2">
        ⏱ Watch your terminal now
      </p>
      {observePrompt && (
        <p className="text-sm text-amber-800 mb-3 leading-relaxed">{observePrompt}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-amber-700 font-medium">
          Auto-reveals in <span className="font-mono tabular-nums font-semibold">{countdown}s</span>
        </span>
        <div className="flex-1 h-2 bg-amber-200 rounded-full overflow-hidden max-w-[200px]">
          <div
            className="h-full bg-amber-600 transition-all duration-1000 rounded-full"
            style={{ width: `${pct}%` }}
            aria-hidden="true"
          />
        </div>
        <button
          type="button"
          onClick={onReveal}
          className="shrink-0 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 transition-colors"
        >
          I saw it — show explanation →
        </button>
      </div>
    </div>
  );
}
