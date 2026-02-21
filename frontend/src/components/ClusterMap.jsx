/**
 * ClusterMap — Visual Pod-to-Node Layout
 *
 * Shows pods grouped inside their node so you can literally watch:
 *   - Pods disappear and reappear during a kill-pod
 *   - Pods migrate out of a drained node to other nodes
 *   - Stress-test pods appear as distinct "simulation" chips
 *
 * Data comes from the existing /api/cluster/status endpoint — no new backend needed.
 */

import { useState } from 'react';
import { Server, Crown, AlertTriangle, Eye, EyeOff, Info } from 'lucide-react';
import Tooltip from './Tooltip';

const OBSERVABILITY_NAMES = ['prometheus', 'grafana', 'kube-state-metrics', 'node-exporter', 'alertmanager'];
const isObservability = (name) => OBSERVABILITY_NAMES.some(s => name?.includes(s));

// ─── Pod chip colours ─────────────────────────────────────────────────────────
const SIM_STATUS_STYLES = {
  running:   'bg-yellow-100 border-yellow-400 text-yellow-800 ring-1 ring-yellow-300',
  succeeded: 'bg-yellow-50 border-yellow-300 text-yellow-600',
  completed: 'bg-yellow-50 border-yellow-300 text-yellow-600',
};
const SIM_DEFAULT_STYLE = 'bg-orange-100 border-orange-400 text-orange-800 ring-1 ring-orange-300 animate-pulse';

const POD_STATUS_STYLES = {
  running:          'bg-green-100 border-green-300 text-green-800',
  pending:          'bg-yellow-100 border-yellow-300 text-yellow-800 animate-pulse',
  terminating:      'bg-red-100 border-red-300 text-red-700 opacity-60 line-through',
  failed:           'bg-red-100 border-red-400 text-red-800 ring-1 ring-red-300',
  oomkilled:        'bg-red-100 border-red-400 text-red-800 ring-1 ring-red-300',
  crashloopbackoff: 'bg-red-100 border-red-400 text-red-800 ring-1 ring-red-300',
  succeeded:        'bg-blue-50 border-blue-200 text-blue-600',
};
const POD_DEFAULT_STYLE = 'bg-gray-100 border-gray-300 text-gray-600';

function podChipStyle(pod) {
  const isSimulation = pod.name?.includes('cpu-stress') || pod.name?.includes('mem-stress');
  const status = (pod.actualStatus || pod.status)?.toLowerCase();
  if (isSimulation) return SIM_STATUS_STYLES[status] || SIM_DEFAULT_STYLE;
  return POD_STATUS_STYLES[status] || POD_DEFAULT_STYLE;
}

// Shorten pod name to readable form: keep app prefix, trim hash suffix
function shortPodName(name = '') {
  const parts = name.split('-');
  // Drop the last two segments (replicaset hash + pod hash)
  if (parts.length > 3) return parts.slice(0, -2).join('-');
  return name;
}

const STATUS_DOT = {
  running:          'bg-green-500',
  pending:          'bg-yellow-400 animate-pulse',
  terminating:      'bg-red-400 opacity-60',
  failed:           'bg-red-500',
  oomkilled:        'bg-red-500',
  crashloopbackoff: 'bg-red-500',
  succeeded:        'bg-blue-400',
};
function statusDot(status) {
  return STATUS_DOT[status?.toLowerCase()] || 'bg-gray-400';
}

// ─── Single pod chip ──────────────────────────────────────────────────────────
const PodChip = ({ pod, isHighlighted }) => {
  const isSimulation = pod.name?.includes('cpu-stress') || pod.name?.includes('mem-stress');
  const statusForDisplay = (pod.actualStatus || pod.status)?.toLowerCase();
  const isOOM = statusForDisplay === 'oomkilled';
  const restartCount = pod.restartCount ?? 0;

  return (
    <div
      title={`${pod.name}\nStatus: ${pod.status}${pod.actualStatus && pod.actualStatus !== pod.status ? ` (${pod.actualStatus})` : ''}\nNode: ${pod.nodeName || 'unscheduled'}${restartCount > 0 ? `\nRestarts: ${restartCount}` : ''}`}
      className={`
        flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-mono
        transition-all duration-300
        ${podChipStyle(pod)}
        ${isHighlighted ? 'ring-2 ring-blue-500 ring-offset-1 scale-105' : ''}
      `}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot(statusForDisplay || pod.status)}`} />
      <span className="truncate max-w-[120px]">
        {shortPodName(pod.name)}
      </span>
      {restartCount > 0 && (
        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-600 font-semibold tabular-nums flex-shrink-0" title={`${restartCount} restart(s)`}>
          ↺{restartCount}
        </span>
      )}
      {isSimulation && (
        <span className="text-[9px] font-bold uppercase tracking-wider opacity-70 flex-shrink-0">
          sim
        </span>
      )}
      {isOOM && (
        <span className="text-[9px] font-bold text-red-600 flex-shrink-0">OOM</span>
      )}
    </div>
  );
};

// Determine which pods to highlight based on active simulation
function getHighlightedPodNames(pods, activeSim) {
  if (!activeSim) return new Set();
  if (activeSim === 'kill-pod')
    return new Set(pods.filter(p => p.name?.includes('backend')).map(p => p.name));
  if (activeSim === 'cpu-stress')
    return new Set(pods.filter(p => p.name?.includes('cpu-stress')).map(p => p.name));
  if (activeSim === 'memory-stress')
    return new Set(pods.filter(p => p.name?.includes('mem-stress')).map(p => p.name));
  if (activeSim === 'db-failure')
    return new Set(pods.filter(p => p.name?.includes('postgres')).map(p => p.name));
  return new Set();
}

// ─── Node zone card ───────────────────────────────────────────────────────────
const NodeZone = ({ node, pods, activeSim, showObservability }) => {
  const isControlPlane = node.role === 'control-plane';
  const isCordoned = node.unschedulable;
  const ip = node.addresses?.find(a => a.type === 'InternalIP')?.address;
  const highlighted = getHighlightedPodNames(pods, activeSim);

  const appPods    = pods.filter(p => !isObservability(p.name));
  const systemPods = pods.filter(p => isObservability(p.name));

  return (
    <div
      className={`
        rounded-xl border-2 p-4 flex flex-col gap-3 transition-all duration-500
        ${isControlPlane ? 'border-purple-300 bg-purple-50/40' : isCordoned ? 'border-orange-400 bg-orange-50/40' : 'border-gray-200 bg-gray-50/60'}
      `}
    >
      {/* Node header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isControlPlane
            ? <Crown className="w-4 h-4 text-purple-500" />
            : <Server className="w-4 h-4 text-gray-400" />
          }
          <div>
            <span className={`font-semibold text-sm ${isControlPlane ? 'text-purple-800' : 'text-gray-800'}`}>
              {node.name}
            </span>
            {ip && <span className="ml-2 text-xs text-gray-400 font-mono">{ip}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {isCordoned && (
            <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded bg-orange-200 text-orange-800 border border-orange-300">
              <AlertTriangle className="w-3 h-3" />
              CORDONED
            </span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium
            ${isControlPlane ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-700 border-blue-200'}
          `}>
            {node.role}
          </span>
          <span className="text-xs text-gray-400">
            {node.allocatable?.cpu} CPU
          </span>
        </div>
      </div>

      {/* App pods */}
      {appPods.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wide">
            App Pods · {appPods.length}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {appPods.map(pod => (
              <PodChip key={pod.name} pod={pod} isHighlighted={highlighted.has(pod.name)} />
            ))}
          </div>
        </div>
      )}

      {/* Observability pods — hidden by default, revealed by toggle */}
      {showObservability && systemPods.length > 0 && (
        <div>
          <p className="text-xs text-gray-300 mb-1.5 font-medium uppercase tracking-wide">
            Observability · {systemPods.length}
          </p>
          <div className="flex flex-wrap gap-1">
            {systemPods.map(pod => (
              <span
                key={pod.name}
                title={pod.name}
                className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 border border-gray-200 text-gray-500 font-mono"
              >
                {shortPodName(pod.name)}
              </span>
            ))}
          </div>
        </div>
      )}

      {appPods.length === 0 && systemPods.length === 0 && (
        <div className="text-xs text-gray-400 italic py-2 text-center border border-dashed border-gray-300 rounded-lg">
          {isCordoned ? 'All pods evicted — node cordoned' : 'No pods scheduled here'}
        </div>
      )}
    </div>
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sortNodes(nodes) {
  return [...nodes].sort((a, b) => {
    if (a.role === 'control-plane') return -1;
    if (b.role === 'control-plane') return 1;
    return a.name.localeCompare(b.name);
  });
}

function groupPodsByNode(pods) {
  const map = {};
  (pods || []).forEach(pod => {
    const key = pod.nodeName || '__unscheduled__';
    if (!map[key]) map[key] = [];
    map[key].push(pod);
  });
  return map;
}

// ─── Main ClusterMap ──────────────────────────────────────────────────────────
const ClusterMap = ({ nodes, pods, isLoading, activeSim }) => {
  const [showObservability, setShowObservability] = useState(false);
  if (isLoading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-5 bg-gray-200 rounded w-32" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => <div key={i} className="h-48 bg-gray-100 rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!nodes?.length) return null;

  const sortedNodes = sortNodes(nodes);
  const podsByNode  = groupPodsByNode(pods);
  const unscheduled = podsByNode['__unscheduled__'] || [];

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Cluster Map</h2>
            <p className="text-xs text-gray-400 mt-0.5">Pods grouped by node — watch them move during simulations</p>
          </div>
          <Tooltip
            content="Pods are distributed across nodes for high availability. If a node goes down, pods on other nodes keep serving traffic."
            side="right"
            width="w-64"
          >
            <Info className="w-4 h-4 text-gray-300 hover:text-gray-500 cursor-help ml-1" />
          </Tooltip>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowObservability(p => !p)}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors border border-gray-200 px-2 py-1 rounded-lg"
          >
            {showObservability ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showObservability ? 'Hide' : 'Show'} observability
          </button>
          <span className="text-xs text-gray-400">{nodes.length} nodes · {pods?.length || 0} pods</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {sortedNodes.map(node => (
          <NodeZone
            key={node.name}
            node={node}
            pods={podsByNode[node.name] || []}
            activeSim={activeSim}
            showObservability={showObservability}
          />
        ))}
      </div>

      {/* Unscheduled pods (pending, no node yet) */}
      {unscheduled.length > 0 && (
        <div className="mt-4 p-3 rounded-lg border border-dashed border-yellow-300 bg-yellow-50">
          <p className="text-xs font-medium text-yellow-700 mb-2">⏳ Unscheduled / Pending</p>
          <div className="flex flex-wrap gap-1.5">
            {unscheduled.map(pod => <PodChip key={pod.name} pod={pod} />)}
          </div>
        </div>
      )}
    </div>
  );
};

export default ClusterMap;

