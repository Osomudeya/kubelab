/**
 * KubeLab — App root
 *
 * Layout: Header → Cluster Overview → Cluster Map + Events Feed → Simulation Panel.
 * Guided/Explore mode toggle in header. Explore: no gates, all sims unlocked.
 */

import { useEffect, useState, useCallback } from 'react';
import { Activity, BookOpen, Zap } from 'lucide-react';
import { Toaster } from 'sonner';
import { useClusterStatus } from './hooks/useClusterStatus';
import ClusterOverview    from './components/ClusterOverview';
import SimulationPanel   from './components/SimulationPanel';
import ClusterMap        from './components/ClusterMap';
import EventsFeed        from './components/EventsFeed';
import OnboardingModal   from './components/OnboardingModal';

const MODE_KEY = 'kubelab_mode';

function App() {
  const [mockMode, setMockMode] = useState(false);
  useEffect(() => {
    fetch('/health')
      .then(r => r.json())
      .then(d => { if (d.mockMode) setMockMode(true); })
      .catch(() => {});
  }, []);

  const [activeSim, setActiveSim] = useState(null);
  const [expandFirstSim, setExpandFirstSim] = useState(false);
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(MODE_KEY) || 'guided'; }
    catch { return 'guided'; }
  });
  const [showSwitchConfirm, setShowSwitchConfirm] = useState(false);
  const toggleMode = useCallback(() => {
    if (mode === 'explore') {
      if (activeSim !== null) {
        setShowSwitchConfirm(true);
        return;
      }
      const next = 'guided';
      try { localStorage.setItem(MODE_KEY, next); } catch (_) {}
      setMode(next);
    } else {
      const next = 'explore';
      try { localStorage.setItem(MODE_KEY, next); } catch (_) {}
      setMode(next);
    }
  }, [mode, activeSim]);

  const confirmSwitchToGuided = useCallback(() => {
    try { localStorage.setItem(MODE_KEY, 'guided'); } catch (_) {}
    setMode('guided');
    setShowSwitchConfirm(false);
  }, []);
  const isFocused = activeSim !== null;
  const { data, isLoading, error } = useClusterStatus(isFocused);

  const logActivity = useCallback(() => {}, []);
  const onObservationState = useCallback(() => {}, []);

  const nodes = data?.data?.nodes;
  const pods  = data?.data?.pods;

  return (
    <div className="min-h-screen bg-gray-50">
      {mode === 'explore' && (
        <div className="fixed top-0 left-0 right-0 h-0.5 bg-orange-500 z-[100]" aria-hidden="true" />
      )}
      <Toaster position="top-right" richColors closeButton duration={5000} />

      {showSwitchConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setShowSwitchConfirm(false)}>
          <div className="bg-white rounded-xl shadow-xl p-5 max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <p className="text-sm text-gray-700 mb-4">
              A simulation is running. Switching to Guided mode will not cancel it, but the page will switch to sequential view. Continue?
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowSwitchConfirm(false)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={confirmSwitchToGuided} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Switch to Guided</button>
            </div>
          </div>
        </div>
      )}

      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Activity className="w-7 h-7 text-blue-600" />
              <div>
                <h1 className="text-xl font-bold text-gray-900 leading-none">KubeLab</h1>
                <p className="text-xs text-gray-400 mt-0.5">Kubernetes Failure Simulation Lab</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleMode}
                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:border-gray-400 transition-colors"
                title={mode === 'guided' ? 'Switch to Explore mode — all simulations unlocked, no gates' : 'Switch to Guided mode — sequential, with terminal gate and quiz'}
              >
                {mode === 'guided' ? (
                  <>
                    <BookOpen className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-gray-600">Guided</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-gray-600">Explore</span>
                  </>
                )}
              </button>
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${isLoading ? 'bg-yellow-400 animate-pulse' : error ? 'bg-red-400' : 'bg-green-400'}`} />
                <span className="text-sm text-gray-500">
                  {isLoading ? 'Connecting…' : error ? 'Error' : 'Live'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {mockMode && (
        <div className="bg-amber-50 border-b border-amber-300 px-4 py-2.5 text-center text-sm text-amber-800">
          <strong className="font-semibold">⚠ Mock Mode</strong> — no Kubernetes cluster detected.
          Simulation buttons return fake responses. No real pods are affected.{' '}
          <a
            href="https://github.com/Osomudeya/kubelab/blob/main/setup/k8s-cluster-setup.md"
            target="_blank"
            rel="noreferrer"
            className="underline font-medium hover:text-amber-900"
          >
            Set up a real cluster →
          </a>
        </div>
      )}

      <OnboardingModal onStartHere={() => setExpandFirstSim(true)} />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            <strong className="font-semibold">Couldn&apos;t connect to cluster — </strong>
            check that the backend is running (port-forward: see README).
            <code className="block mt-1 text-xs bg-red-100 px-2 py-1 rounded">
              kubectl get pods -n kubelab -l app=backend
            </code>
          </div>
        )}

        {!error && !isLoading && data?.data && (nodes?.length === 0) && (pods?.length === 0) && !mockMode && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
            <strong className="font-semibold">Connected to backend but no pods found.</strong>
            {' '}Run <code className="text-xs bg-amber-100 px-1.5 py-0.5 rounded">kubectl get pods -n kubelab</code> to check deployment status. If nothing is deployed, run the deploy script from the README.
          </div>
        )}

        <ClusterOverview data={data} isLoading={isLoading} />

        {/* Map + Events: when a sim is active, show in sticky bottom drawer (40% viewport); otherwise inline. */}
        {isFocused ? (
          <div
            className="hidden md:flex fixed bottom-0 left-0 right-0 z-20 flex-col border-t border-gray-200 bg-gray-50 shadow-[0_-4px_20px_rgba(0,0,0,0.08)]"
            style={{ height: '40vh', maxHeight: 480 }}
            aria-label="Live cluster map and events during simulation"
          >
            <div className="flex-1 grid grid-cols-1 xl:grid-cols-5 gap-4 p-4 min-h-0">
              <div className="xl:col-span-3 min-h-0">
                <ClusterMap nodes={nodes} pods={pods} isLoading={isLoading} activeSim={activeSim} />
              </div>
              <div className="xl:col-span-2 flex flex-col min-h-0">
                <EventsFeed />
              </div>
            </div>
          </div>
        ) : (
          <div className="hidden md:block">
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-4" style={{ minHeight: 280 }}>
              <div className="xl:col-span-3 min-h-[260px]">
                <ClusterMap nodes={nodes} pods={pods} isLoading={isLoading} activeSim={activeSim} />
              </div>
              <div className="xl:col-span-2 flex flex-col min-h-[260px]">
                <EventsFeed />
              </div>
            </div>
          </div>
        )}
        <div className="md:hidden py-2 text-center text-sm text-gray-500">
          Open on desktop to see the live cluster map and events feed.
        </div>

        <SimulationPanel
          mode={mode}
          onModeChange={setMode}
          activeSim={activeSim}
          onActivity={logActivity}
          onSimStart={(simId) => setActiveSim(simId)}
          onSimComplete={() => setActiveSim(null)}
          onObservationState={onObservationState}
          mockMode={mockMode}
          expandFirstSim={expandFirstSim}
          onAckExpandFirstSim={() => setExpandFirstSim(false)}
        />

      </main>

      <footer className="mt-8 border-t border-gray-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <p className="text-center text-xs text-gray-400">
            {mockMode
              ? 'KubeLab — mock mode active. Connect to a real cluster for live simulations.'
              : 'KubeLab — every action calls the real Kubernetes API'}
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
