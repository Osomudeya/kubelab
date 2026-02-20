/**
 * KubeLab — App root
 *
 * Layout:
 *   Header (sticky)
 *   Cluster Overview
 *   Metrics / Observability hint
 *   Simulation Panel  ← primary learning zone
 *   What Just Happened (appears after first action)
 *   Two-column: Cluster Map | Events Feed
 *   Onboarding Modal (first visit only)
 *
 * Focus Mode: when a simulation is running, non-essential sections dim
 * so attention naturally moves to Cluster Map + Events Feed.
 */

import { useEffect, useState, useCallback } from 'react';
import { Activity, Clock } from 'lucide-react';
import { Toaster } from 'sonner';
import { useClusterStatus } from './hooks/useClusterStatus';
import ClusterOverview    from './components/ClusterOverview';
import MetricsSummary     from './components/MetricsSummary';
import SimulationPanel    from './components/SimulationPanel';
import ClusterMap         from './components/ClusterMap';
import EventsFeed         from './components/EventsFeed';
import WhatJustHappened   from './components/WhatJustHappened';
import OnboardingModal    from './components/OnboardingModal';
import ControlLoopCard    from './components/ControlLoopCard';
import SimFlashcard       from './components/SimFlashcard';

function App() {
  const { data, isLoading, error } = useClusterStatus();

  // Mock mode — true when running in Docker Compose without a real cluster
  const [mockMode, setMockMode] = useState(false);
  useEffect(() => {
    fetch('/health')
      .then(r => r.json())
      .then(d => { if (d.mockMode) setMockMode(true); })
      .catch(() => {});
  }, []);

  // Activity log — narrative entries shown in WhatJustHappened
  const [activityLog, setActivityLog] = useState([]);

  // Focus mode — set while a simulation is actively running
  const [activeSim, setActiveSim] = useState(null);
  // Flashcard — shows "what just happened" after completion until dismissed
  const [lastCompletedSim, setLastCompletedSim] = useState(null);

  const dismissFlashcard = useCallback(() => setLastCompletedSim(null), []);

  const logActivity = useCallback((label, detail, ok = true, narrative = null) => {
    setActivityLog(prev => [{
      id:   Date.now(),
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }),
      emoji: narrative?.emoji || (ok ? '✅' : '⚠️'),
      label,
      detail,
      ok,
      narrative,
    }, ...prev].slice(0, 20));
  }, []);

  const clearLog = useCallback(() => setActivityLog([]), []);

  // Keyboard shortcuts
  useEffect(() => {
    const handle = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('killPodShortcut'));
      }
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, []);

  const nodes = data?.data?.nodes;
  const pods  = data?.data?.pods;
  const isFocused = activeSim !== null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-right" richColors closeButton duration={5000} />
      <OnboardingModal />

      {/* ── Header ── */}
      <header className={`bg-white border-b border-gray-200 shadow-sm sticky top-0 z-30 transition-opacity duration-500 ${isFocused ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
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
              {activityLog.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-gray-500">
                  <Clock className="w-3.5 h-3.5" />
                  {activityLog.length} action{activityLog.length !== 1 ? 's' : ''} this session
                </span>
              )}
              {isFocused && (
                <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 font-semibold animate-pulse">
                  Simulation running…
                </span>
              )}
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

      {/* ── Mock Mode Banner ── */}
      {mockMode && (
        <div className="bg-amber-50 border-b border-amber-300 px-4 py-2.5 text-center text-sm text-amber-800">
          <strong className="font-semibold">⚠ Mock Mode</strong> — no Kubernetes cluster detected.
          Simulation buttons return fake responses. No real pods are affected.{' '}
          <a
            href="https://github.com/Osomudeya/kubelab/blob/main/setup/k8s-setup.md"
            target="_blank"
            rel="noreferrer"
            className="underline font-medium hover:text-amber-900"
          >
            Set up a real cluster →
          </a>
        </div>
      )}

      {/* ── Main ── */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">

        {/* Connection error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
            <strong className="font-semibold">Couldn&apos;t connect to cluster — </strong>
            check that the backend is running.
            <code className="block mt-1 text-xs bg-red-100 px-2 py-1 rounded">
              kubectl get pods -n kubelab -l app=backend
            </code>
          </div>
        )}

        {/* Cluster overview — dims during focus */}
        <div className={`transition-opacity duration-500 ${isFocused ? 'opacity-30' : 'opacity-100'}`}>
          <ClusterOverview data={data} isLoading={isLoading} />
        </div>

        {/* Metrics hint — dims during focus */}
        <div className={`transition-opacity duration-500 ${isFocused ? 'opacity-30' : 'opacity-100'}`}>
          <MetricsSummary isLoading={isLoading} />
        </div>

        {/* ── Control loop explainer — always visible, dims slightly in focus ── */}
        <div className={`transition-opacity duration-500 ${isFocused ? 'opacity-40' : 'opacity-100'}`}>
          <ControlLoopCard />
        </div>

        {/* ── Primary learning zone — never dims ── */}
        <SimulationPanel
          onActivity={logActivity}
          onSimStart={(simId) => { setActiveSim(simId); setLastCompletedSim(null); }}
          onSimComplete={(simId) => { setActiveSim(null); setLastCompletedSim(simId); }}
          mockMode={mockMode}
        />

        {/* ── Flashcard: auto-appears on sim start, transitions to "what happened" after ── */}
        {(activeSim || lastCompletedSim) && (
          <SimFlashcard
            activeSim={activeSim}
            lastCompletedSim={lastCompletedSim}
            onDismiss={dismissFlashcard}
          />
        )}

        {/* What Just Happened — appears after first action */}
        {activityLog.length > 0 && (
          <WhatJustHappened entries={activityLog} onClear={clearLog} />
        )}

        {/* ── Two-column: Cluster Map + Events Feed ── */}
        {/* Both get a highlighted ring during focus mode */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
          <div className={`xl:col-span-3 transition-all duration-300 ${isFocused ? 'ring-2 ring-blue-400 ring-offset-2 rounded-xl' : ''}`}>
            <ClusterMap nodes={nodes} pods={pods} isLoading={isLoading} activeSim={activeSim} />
          </div>
          <div className={`xl:col-span-2 flex flex-col transition-all duration-300 ${isFocused ? 'ring-2 ring-blue-400 ring-offset-2 rounded-xl' : ''}`}>
            <EventsFeed />
          </div>
        </div>

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
