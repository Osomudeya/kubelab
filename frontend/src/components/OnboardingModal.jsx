/**
 * OnboardingModal — First-time flow: terminal, run in order, watch map/events, read & quiz.
 * Dismissible; "Start with Kill Random Pod" expands first sim and scrolls to it.
 */

const ONBOARDING_KEY = 'kubelab_onboarding_seen';

export default function OnboardingModal({ onStartHere }) {
  const seen = (() => {
    try {
      return !!localStorage.getItem(ONBOARDING_KEY);
    } catch {
      return false;
    }
  })();

  const dismiss = () => {
    try {
      localStorage.setItem(ONBOARDING_KEY, '1');
    } catch (_) {}
    onStartHere?.();
  };

  if (seen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" aria-modal="true" role="dialog" aria-labelledby="onboarding-title">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6">
        <h2 id="onboarding-title" className="text-lg font-bold text-gray-900 mb-4">
          How KubeLab works
        </h2>
        <div className="text-sm text-gray-700 space-y-4">
          <p className="leading-relaxed">
            You learn Kubernetes by watching it break.
          </p>
          <p className="leading-relaxed font-medium">
            Here&apos;s how the lab works:
          </p>
          <ol className="list-decimal list-inside space-y-3 pl-2">
            <li className="leading-relaxed">
              <strong>Open a terminal</strong> — keep it next to this window the whole time.
              Every simulation has exact commands to run before you click anything.
            </li>
            <li className="leading-relaxed">
              <strong>Run simulations in order</strong> — each one builds on the last.
              Click &quot;Start here →&quot; to begin with Kill Random Pod.
            </li>
            <li className="leading-relaxed">
              <strong>After each simulation</strong> — scroll down to see the Cluster Map
              and Events Feed update live.
            </li>
            <li className="leading-relaxed">
              <strong>Read what happened</strong> — answer the quiz before moving on.
              You can&apos;t skip it. That&apos;s the point.
            </li>
          </ol>
          <p className="leading-relaxed font-medium pt-2">
            Before you start, make sure port-forwarding is running:
          </p>
          <pre className="text-xs bg-gray-100 rounded-lg p-3 font-mono text-gray-800 overflow-x-auto">
{`kubectl port-forward -n kubelab svc/frontend 8080:80
kubectl port-forward -n kubelab svc/grafana 3000:3000`}
          </pre>
          <p className="text-xs text-gray-600 leading-relaxed">
            If you see a connection error, the backend isn&apos;t reachable yet.
            Run: <code className="bg-gray-100 px-1 rounded">kubectl get pods -n kubelab</code> — all 11 should be Running.
          </p>
        </div>
        <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-end">
          <button
            type="button"
            onClick={dismiss}
            className="px-4 py-2.5 text-sm font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            Start with Kill Random Pod →
          </button>
        </div>
      </div>
    </div>
  );
}
