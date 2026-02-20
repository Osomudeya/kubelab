/**
 * OnboardingModal — First-time user welcome
 *
 * Appears once on first visit (localStorage flag: kubelab_onboarded).
 * Orients the user to the lab before they touch anything.
 */

import { useEffect, useState } from 'react';
import { Activity, Terminal, Map, BookOpen, ArrowRight, X } from 'lucide-react';

const STORAGE_KEY = 'kubelab_onboarded';

const steps = [
  {
    icon: Activity,
    color: 'text-red-500 bg-red-50',
    label: 'Choose a simulation',
    detail: 'Each button triggers a real Kubernetes API call — nothing is mocked.',
  },
  {
    icon: Terminal,
    color: 'text-green-600 bg-green-50',
    label: 'Watch the events feed',
    detail: 'See the control-plane respond in real time: Killing → Scheduled → Started.',
  },
  {
    icon: Map,
    color: 'text-blue-500 bg-blue-50',
    label: 'Watch the cluster map',
    detail: 'Pods move between nodes. Cordoned nodes show a banner. OOMKilled pods flash red.',
  },
  {
    icon: BookOpen,
    color: 'text-purple-500 bg-purple-50',
    label: 'Read what happened and why',
    detail: 'The activity log records every action. The k8s/simulation/ files explain the mechanics.',
  },
];

// ─── Sub-components to keep the render function under the line limit ──────────
const ModalHeader = () => (
  <div className="flex items-center gap-3 mb-2">
    <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center flex-shrink-0">
      <Activity className="w-5 h-5 text-white" />
    </div>
    <div>
      <h2 className="text-xl font-bold text-gray-900">Welcome to KubeLab</h2>
      <p className="text-sm text-gray-400">You learn Kubernetes by watching it break.</p>
    </div>
  </div>
);

const StepList = () => (
  <ol className="space-y-3 mb-8">
    {steps.map((s, i) => {
      const Icon = s.icon;
      return (
        <li key={i} className="flex items-start gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${s.color}`}>
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <span className="text-sm font-semibold text-gray-800">{s.label}</span>
            <p className="text-xs text-gray-500 mt-0.5">{s.detail}</p>
          </div>
        </li>
      );
    })}
  </ol>
);

const StartHint = () => (
  <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-6 flex items-start gap-2">
    <ArrowRight className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
    <p className="text-sm text-blue-800">
      Start with <strong>Kill Random Pod</strong> — it demonstrates Kubernetes
      self-healing and is the foundation for everything else.
    </p>
  </div>
);

const OnboardingModal = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
  }, []);

  const dismiss = (scrollToSim = false) => {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
    if (scrollToSim) {
      // Small delay lets the modal fade before scrolling
      setTimeout(() => {
        const el = document.getElementById('sim-kill-pod');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Flash a highlight ring briefly to draw the eye
          el.classList.add('ring-4', 'ring-blue-400', 'ring-offset-2');
          setTimeout(() => el.classList.remove('ring-4', 'ring-blue-400', 'ring-offset-2'), 2000);
        }
      }, 150);
    }
  };

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
      onClick={() => dismiss(false)}
    >
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-8"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={() => dismiss(false)}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <ModalHeader />

        <p className="text-sm text-gray-600 mt-4 mb-6 leading-relaxed">
          This lab lets you break things safely against a real cluster, with real API calls,
          then watch Kubernetes fix itself.
        </p>

        <StepList />
        <StartHint />

        <div className="flex items-center justify-between">
          <button
            onClick={() => dismiss(false)}
            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Don&apos;t show again
          </button>
          <button
            onClick={() => dismiss(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            Start with Kill Random Pod
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingModal;

