/**
 * DeepDive — Control-plane anatomy, kubectl verification, production trap
 *
 * Content comes from data/simulations.js (SIMULATIONS[id].deepDive).
 */

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Terminal, AlertTriangle, Shield, Layers } from 'lucide-react';
import { SIMULATIONS } from '../data/simulations';

// ─── Anatomy step ─────────────────────────────────────────────────────────────
const AnatomyStep = ({ step, text }) => (
  <div className="flex gap-3">
    <div className="w-5 h-5 rounded-full bg-slate-700 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
      {step}
    </div>
    <p className="text-xs text-slate-300 leading-relaxed">{text}</p>
  </div>
);

// ─── Kubectl command block ────────────────────────────────────────────────────
const KubectlBlock = ({ cmd, annotation }) => (
  <div className="space-y-1.5">
    <div className="flex items-start gap-2 bg-black/60 rounded-lg px-3 py-2">
      <span className="text-green-400 font-mono text-xs select-none flex-shrink-0 mt-0.5">$</span>
      <code className="font-mono text-xs text-green-300 break-all leading-relaxed">{cmd}</code>
    </div>
    <p className="text-xs text-slate-400 pl-2 leading-relaxed border-l-2 border-slate-700">{annotation}</p>
  </div>
);

// ─── Section wrapper ──────────────────────────────────────────────────────────
const Section = ({ icon: Icon, title, color, children }) => (
  <div>
    <div className={`flex items-center gap-2 mb-2.5 ${color}`}>
      <Icon className="w-4 h-4" />
      <span className="text-xs font-bold uppercase tracking-wider">{title}</span>
    </div>
    {children}
  </div>
);

// ─── DeepDive ─────────────────────────────────────────────────────────────────
const DeepDive = ({ simId, defaultOpen = false }) => {
  const [open, setOpen] = useState(!!defaultOpen);
  useEffect(() => {
    if (defaultOpen && !open) setOpen(true);
  }, [defaultOpen]);
  const content = SIMULATIONS[simId]?.deepDive;
  if (!content) return null;

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(p => !p)}
        className="flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-800 transition-colors"
      >
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {open ? 'Hide' : 'Show'} control-plane deep dive
      </button>

      {open && (
        <div className="mt-3 bg-slate-900 rounded-xl p-5 space-y-6">

          {/* Kill Pod: reconciliation loop pseudocode as visual header */}
          {simId === 'kill-pod' && (
            <div className="bg-blue-900 rounded-xl p-5 font-mono text-xs leading-relaxed text-blue-100">
              <p className="text-blue-400 mb-1">// Every Kubernetes controller runs this loop, forever</p>
              <p>{'for {'}</p>
              <p className="pl-4">{'desired := read_from_etcd()    // what you declared in YAML'}</p>
              <p className="pl-4">{'actual  := observe_cluster()    // what is actually running'}</p>
              <p className="pl-4 mt-1">{'if desired != actual {'}</p>
              <p className="pl-8">{'act_to_converge(desired, actual) // create, delete, patch'}</p>
              <p className="pl-4">{'}'}</p>
              <p className="pl-4 mt-1">{'sleep(~100ms)'}</p>
              <p>{'}'}</p>
            </div>
          )}

          {/* Anatomy */}
          <Section icon={Layers} title="Control Plane Anatomy" color="text-blue-400">
            <div className="space-y-3">
              {content.anatomy.map(s => <AnatomyStep key={s.step} {...s} />)}
            </div>
          </Section>

          {/* Verify */}
          <Section icon={Terminal} title="Verify in Your Terminal" color="text-green-400">
            <div className="space-y-4">
              {content.verify.map((v, i) => <KubectlBlock key={i} {...v} />)}
            </div>
          </Section>

          {/* Production Trap */}
          <Section icon={AlertTriangle} title="The Production Trap" color="text-red-400">
            <div className="bg-red-900/30 border border-red-700/40 rounded-lg p-3">
              <p className="text-xs text-red-200 leading-relaxed">{content.trap}</p>
            </div>
          </Section>

          {/* Defend */}
          <Section icon={Shield} title="How to Defend Against This" color="text-emerald-400">
            <div className="bg-emerald-900/30 border border-emerald-700/40 rounded-lg p-3">
              <p className="text-xs text-emerald-200 leading-relaxed">{content.defend}</p>
            </div>
          </Section>

        </div>
      )}
    </div>
  );
};

export default DeepDive;

