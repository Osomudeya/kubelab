/**
 * ControlLoopCard
 *
 * One canonical explanation of the Kubernetes reconciliation loop.
 * Every simulation in this lab is a way to force drift between desired
 * and actual state — and watch the loop react.
 *
 * Collapsible. Starts collapsed after first read (localStorage flag).
 */

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';

const READ_KEY = 'kubelab_loop_read';

const LoopCode = () => (
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
);

const CardBody = () => (
  <div className="px-5 pb-5 space-y-5">
    <LoopCode />
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {[
        ['Who runs this loop?', <>The <strong>kube-controller-manager</strong> — dozens of controllers (ReplicaSet, Job, StatefulSet, Endpoints). Each watches its resource type in etcd via the API server watch mechanism.</>],
        ['What is etcd?', <><strong>Everything</strong> you declare with kubectl is stored here. Controllers never talk to each other directly — only through reads/writes to etcd via the API server.</>],
        ['Why does this matter?', <>The loop never stops. A pod killed at 3am, a node drained, a memory spike — the cluster <strong>always</strong> tries to return to desired state. That is self-healing.</>],
      ].map(([title, body]) => (
        <div key={title} className="bg-white rounded-lg p-4 border border-blue-100">
          <p className="text-xs font-bold text-blue-800 mb-1.5">{title}</p>
          <p className="text-xs text-gray-600 leading-relaxed">{body}</p>
        </div>
      ))}
    </div>
    <div className="bg-blue-100 rounded-lg px-4 py-3">
      <p className="text-xs font-bold text-blue-900 mb-2">Every simulation below forces drift:</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        {[['Kill Pod','Removes a pod → ReplicaSet creates a replacement'],['Drain Node','Cordons a node → Scheduler moves pods to healthy nodes'],['CPU Stress',"Saturates CPU → CFS throttles the container's cgroup"],['Memory Stress','Exceeds limit → Kernel OOM killer fires SIGKILL'],['DB Failure','Scales StatefulSet to 0 → app loses its backing store']].map(([s, e]) => (
          <p key={s} className="text-xs text-blue-800"><span className="font-semibold">{s}:</span> <span className="text-blue-700">{e}</span></p>
        ))}
      </div>
    </div>
    <p className="text-xs text-blue-500 text-right">Click any simulation to trigger the drift — then watch the loop react.</p>
  </div>
);

const ControlLoopCard = () => {
  const [open, setOpen] = useState(() => {
    try { return !localStorage.getItem(READ_KEY); }
    catch { return true; }
  });

  useEffect(() => {
    if (!open) {
      try { localStorage.setItem(READ_KEY, '1'); } catch { /* noop */ }
    }
  }, [open]);

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50">
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left"
        onClick={() => setOpen(p => !p)}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
            <RefreshCw className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-blue-900">The Kubernetes Control Loop — Read This First</p>
            <p className="text-xs text-blue-600 mt-0.5">The single principle behind every simulation in this lab</p>
          </div>
        </div>
        {open
          ? <ChevronUp className="w-4 h-4 text-blue-500 flex-shrink-0" />
          : <ChevronDown className="w-4 h-4 text-blue-500 flex-shrink-0" />
        }
      </button>
      {open && <CardBody />}
    </div>
  );
};

export default ControlLoopCard;

