/**
 * EventsFeed — Live Kubernetes Events
 *
 * Real-time equivalent of: kubectl get events -n kubelab --sort-by=lastTimestamp
 *
 * After every simulation, you watch the actual control-plane fire:
 *   Killing → Scheduled → Pulled → Created → Started (pod kill recovery)
 *   OOMKilling → BackOff (memory stress)
 *   Evicting → Scheduled on new node (node drain)
 */

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Terminal, Circle } from 'lucide-react';
import api from '../services/api';

// ─── Plain-English annotations (click a row to expand) ───────────────────────
const EVENT_ANNOTATIONS = {
  Killing:         'Kubernetes sent SIGTERM to this container. It has up to 30s to finish in-flight work and shut down cleanly. If it doesn\'t exit in time, SIGKILL follows.',
  Scheduled:       'The scheduler picked a node for this pod based on available CPU/memory, taints, and affinity rules. Image pull starts next — this is where "Pending" time is spent.',
  Pulled:          'The container image is now cached on this node. The container will start within milliseconds.',
  Started:         'Container is running. It won\'t receive traffic until its readiness probe passes.',
  BackOff:         'The container crashed and Kubernetes is waiting before restarting it. Each restart doubles the wait (10s → 20s → 40s → max 5min). This is CrashLoopBackOff.',
  OOMKilling:      'The container exceeded its memory limit. The Linux kernel sent SIGKILL (signal 9, exit code 137) — no graceful shutdown, no warning. Data in memory is lost.',
  Evicted:         'This pod was forcibly moved off its node — either by a drain, or because the node ran low on disk/memory. The scheduler will place it on a healthy node.',
  SuccessfulCreate:'The ReplicaSet controller just created this pod to match desired state. This fires every time Kubernetes self-heals — the reconciliation loop in action.',
  ScalingReplicaSet:'A Deployment or ReplicaSet scaled up or down. The replica count changed.',
  Failed:          'This container failed to start or exited with a non-zero code. Check "describe pod" for the specific error — image pull failure, config error, or crash.',
  FailedMount:     'A volume couldn\'t be mounted. Common causes: PVC not Bound, wrong StorageClass, or trying to mount a ReadWriteOnce PVC that\'s already in use by another pod.',
  Preempting:      'A higher-priority pod needs resources. This pod is being removed to make room — it will be rescheduled when capacity is available.',
  Completed:       'This Job pod ran to completion successfully. The Job controller marks it done and won\'t create another pod.',
};

// ─── colour coding by event reason ───────────────────────────────────────────
const REASON_STYLES = {
  // Pod lifecycle — normal healthy flow
  Scheduled:       { dot: 'bg-blue-400',   text: 'text-blue-300',   label: 'Scheduled' },
  Pulled:          { dot: 'bg-green-500',  text: 'text-green-300',  label: 'Pulled' },
  Created:         { dot: 'bg-green-500',  text: 'text-green-300',  label: 'Created' },
  Started:         { dot: 'bg-green-400',  text: 'text-green-300',  label: 'Started' },
  // Deletion / eviction
  Killing:         { dot: 'bg-orange-400', text: 'text-orange-300', label: 'Killing' },
  Preempting:      { dot: 'bg-orange-400', text: 'text-orange-300', label: 'Preempting' },
  Evicted:         { dot: 'bg-orange-500', text: 'text-orange-300', label: 'Evicted' },
  // Failure states
  OOMKilling:      { dot: 'bg-red-500',    text: 'text-red-300',    label: 'OOMKilling' },
  BackOff:         { dot: 'bg-red-400',    text: 'text-red-300',    label: 'BackOff' },
  Failed:          { dot: 'bg-red-500',    text: 'text-red-300',    label: 'Failed' },
  FailedMount:     { dot: 'bg-red-400',    text: 'text-red-300',    label: 'FailedMount' },
  // Controller / job events
  SuccessfulCreate:{ dot: 'bg-purple-400', text: 'text-purple-300', label: 'Pod Created' },
  ScalingReplicaSet:{ dot: 'bg-purple-300', text: 'text-purple-200', label: 'Scaling' },
  Completed:       { dot: 'bg-purple-300', text: 'text-purple-300', label: 'Completed' },
};

const defaultStyle = { dot: 'bg-gray-500', text: 'text-gray-300', label: null };

function getStyle(reason) {
  return REASON_STYLES[reason] || defaultStyle;
}

// Observability stack pod names — their probe noise hides the real signal
const OBS_PREFIXES = ['node-exporter', 'prometheus', 'grafana', 'kube-state-metrics', 'alertmanager'];
const isObsEvent = (evt) => OBS_PREFIXES.some(p => (evt.object || '').includes(p));

function formatTime(ts) {
  if (!ts) return '--:--:--';
  return new Date(ts).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

// Shorten pod/job names for readability: keep prefix + short suffix
function shortName(name = '') {
  if (name.length <= 30) return name;
  const parts = name.split('-');
  // Keep first 3 segments + last segment (the random hash)
  return `${parts.slice(0, 3).join('-')}-…-${parts[parts.length - 1]}`;
}

const EventsFeed = () => {
  const listRef = useRef(null);
  const [paused, setPaused]       = useState(false);
  const [prevCount, setPrevCount] = useState(0);
  const [expandedIdx, setExpandedIdx] = useState(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['clusterEvents'],
    queryFn: async () => {
      const res = await api.get('/cluster/events?limit=50');
      return res.data;
    },
    refetchInterval: paused ? false : 3000,
    refetchIntervalInBackground: false,
  });

  const [showObs, setShowObs] = useState(false);
  const allEvents = data?.data?.events || [];
  const hiddenCount = allEvents.filter(isObsEvent).length;
  const events = showObs ? allEvents : allEvents.filter(e => !isObsEvent(e));

  // Flash the list container briefly when new events arrive
  useEffect(() => {
    if (events.length !== prevCount && events.length > 0) {
      setPrevCount(events.length);
    }
  }, [events.length, prevCount]);

  return (
    <div className="bg-gray-950 rounded-lg border border-gray-800 flex flex-col" style={{ height: '340px' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-green-400" />
          <span className="text-sm font-mono font-semibold text-gray-100">kubectl get events -n kubelab -w</span>
        </div>
        <div className="flex items-center gap-3">
          {!isLoading && !isError && (
            <span className="text-xs text-gray-500 font-mono">{events.length} events</span>
          )}
          <button
            onClick={() => setPaused(p => !p)}
            className={`text-xs px-2 py-0.5 rounded font-mono border transition-colors ${
              paused
                ? 'border-yellow-600 text-yellow-400 bg-yellow-900/20'
                : 'border-gray-700 text-gray-400 hover:border-gray-500'
            }`}
          >
            {paused ? '▶ resume' : '⏸ pause'}
          </button>
          {/* Live indicator */}
          {!paused && (
            <span className="flex items-center gap-1 text-xs text-green-400 font-mono">
              <Circle className="w-2 h-2 fill-green-400 animate-pulse" />
              live
            </span>
          )}
        </div>
      </div>

      {/* Event rows */}
      <div
        ref={listRef}
        className="flex-1 overflow-y-auto font-mono text-xs leading-relaxed"
      >
        {isLoading && (
          <div className="flex items-center justify-center h-full text-gray-500">
            <span className="animate-pulse">connecting to cluster…</span>
          </div>
        )}
        {isError && (
          <div className="flex items-center justify-center h-full text-red-400">
            failed to fetch events
          </div>
        )}
        {!isLoading && !isError && events.length === 0 && (
          <div className="flex items-center justify-center h-full text-gray-600">
            no recent events — trigger a simulation
          </div>
        )}
        {!isLoading && events.map((evt, i) => {
          const style      = getStyle(evt.reason);
          const isWarning  = evt.type === 'Warning';
          const annotation = EVENT_ANNOTATIONS[evt.reason];
          const isExpanded = expandedIdx === i;

          return (
            <div key={`${evt.timestamp}-${evt.reason}-${evt.object}-${i}`}>
              {/* ── Event row ─────────────────────────────────────────────── */}
              <div
                onClick={() => annotation && setExpandedIdx(isExpanded ? null : i)}
                className={`flex items-start gap-2 px-4 py-1 border-b border-gray-900/60 transition-colors
                  ${isWarning ? 'bg-red-950/10' : ''}
                  ${annotation ? 'cursor-pointer hover:bg-gray-900/50' : 'hover:bg-gray-900/30'}
                  ${isExpanded ? 'bg-blue-950/30' : ''}
                `}
            >
              {/* Time */}
              <span className="text-gray-600 flex-shrink-0 w-20 pt-px">
                {formatTime(evt.timestamp)}
              </span>

              {/* Status dot */}
              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${style.dot}`} />

              {/* Reason */}
              <span className={`flex-shrink-0 w-24 font-semibold ${style.text}`}>
                {style.label || evt.reason}
              </span>

              {/* Kind + object */}
              <span className="text-gray-500 flex-shrink-0 w-8">
                {evt.kind?.[0] || '?'}
              </span>
              <span className="text-gray-300 flex-shrink-0 w-44 truncate">
                {shortName(evt.object)}
              </span>

              {/* Message */}
              <span className="text-gray-500 truncate flex-1 min-w-0">
                {evt.message}
              </span>

                {/* Annotation hint + count */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {annotation && (
                    <span className={`text-xs transition-colors ${isExpanded ? 'text-blue-400' : 'text-gray-700'}`}>
                      {isExpanded ? '▲' : '▼'}
                    </span>
                  )}
              {evt.count > 1 && (
                    <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-full bg-gray-700 text-gray-300 text-xs font-semibold tabular-nums" title={`${evt.count} occurrences`}>
                      ×{evt.count}
                    </span>
                  )}
                </div>
              </div>

              {/* ── Annotation row (expanded) ──────────────────────────────── */}
              {isExpanded && annotation && (
                <div className="px-4 py-2.5 bg-blue-950/40 border-b border-blue-900/30 flex items-start gap-2">
                  <span className="text-blue-400 text-xs flex-shrink-0 mt-0.5">💡</span>
                  <p className="text-xs text-blue-200 leading-relaxed">{annotation}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-4 py-1.5 border-t border-gray-800 flex-shrink-0 flex items-center justify-between">
        <p className="text-xs text-gray-600 font-mono">
          {events.length === 0 && !showObs
            ? 'Trigger a simulation above and watch Kubernetes respond here in real time.'
            : `${events.length} events — click any row ▼ for a plain-English explanation`}
        </p>
        {hiddenCount > 0 && (
          <button
            onClick={() => setShowObs(p => !p)}
            className="text-xs text-gray-600 hover:text-gray-400 font-mono transition-colors"
          >
            {showObs ? `hide monitoring (${hiddenCount})` : `+${hiddenCount} monitoring noise hidden`}
          </button>
        )}
      </div>
    </div>
  );
};

export default EventsFeed;

