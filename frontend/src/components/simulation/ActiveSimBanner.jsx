import { Loader2 } from 'lucide-react';

export default function ActiveSimBanner({ cpuCountdown, memoryCountdown, drainPending }) {
  if (!cpuCountdown && !memoryCountdown && !drainPending) return null;
  return (
    <div className="mb-4 space-y-2">
      {cpuCountdown > 0 && (
        <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-yellow-800 flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
              CPU Stress Running
            </span>
            <span className="text-xs font-mono text-yellow-700 font-semibold tabular-nums">{cpuCountdown}s</span>
          </div>
          <div className="h-1.5 bg-yellow-200 rounded-full overflow-hidden">
            <div className="h-1.5 bg-yellow-500 rounded-full transition-all duration-1000 ease-linear" style={{ width: `${(cpuCountdown / 60) * 100}%` }} />
          </div>
          <p className="text-xs text-yellow-700 mt-2">
            Run: <code className="bg-yellow-100 px-1 py-0.5 rounded font-mono">kubectl top pods -n kubelab</code>
            {' '}— one backend pod should be pegged at 200m
          </p>
        </div>
      )}
      {memoryCountdown > 0 && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-red-800 flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              OOMKill window
            </span>
            <span className="text-xs font-mono text-red-700 font-semibold tabular-nums">~{memoryCountdown}s</span>
          </div>
          <div className="h-1.5 bg-red-200 rounded-full overflow-hidden">
            <div className="h-1.5 bg-red-500 rounded-full transition-all duration-1000 ease-linear" style={{ width: `${(memoryCountdown / 20) * 100}%` }} />
          </div>
          <p className="text-xs text-red-700 mt-2">
            Run: <code className="bg-red-100 px-1 py-0.5 rounded font-mono">kubectl get pods -n kubelab -w</code>
          </p>
        </div>
      )}
      {drainPending && (
        <div className="rounded-lg bg-orange-50 border border-orange-200 p-3">
          <div className="flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 text-orange-500 animate-spin flex-shrink-0" />
            <span className="text-xs font-bold text-orange-800">Draining node — evicting pods (30–60s)</span>
          </div>
          <p className="text-xs text-orange-700 mt-2">
            Run: <code className="bg-orange-100 px-1 py-0.5 rounded font-mono">kubectl get events -n kubelab -w</code>
          </p>
        </div>
      )}
    </div>
  );
}
