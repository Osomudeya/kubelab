/**
 * PreflightCheck — cluster health check bar shown above the Run button.
 * Presentational: receives result from parent (computed via PRE_FLIGHT in SimulationPanel).
 */

export default function PreflightCheck({ result }) {
  if (!result) return null;
  return (
    <div
      className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg mb-3 border ${
        result.ok
          ? 'bg-green-50 border-green-200 text-green-700'
          : 'bg-yellow-50 border-yellow-300 text-yellow-800'
      }`}
      role="status"
    >
      <span>{result.ok ? '✅' : '⚠️'}</span>
      <span className="font-medium">{result.msg}</span>
    </div>
  );
}
