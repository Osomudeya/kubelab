/**
 * ClusterOverview — Cluster health at a glance with contextual tooltips
 */

import { Activity, Server, AlertCircle, CheckCircle, HelpCircle } from 'lucide-react';
import Tooltip from './Tooltip';

const TOOLTIPS = {
  'Total Pods':   'Every pod currently running in the kubelab namespace. A pod is the smallest deployable unit — one or more containers that share a network and storage.',
  'Running Pods': 'Pods that passed their readiness probe and are actively receiving traffic. This is the number you want to match Total Pods.',
  'Total Nodes':  'The machines (VMs) that make up your cluster. Pods are scheduled onto nodes by the Kubernetes scheduler.',
  'Issues':       'Pods in Failed, CrashLoopBackOff, or Pending state. Pending means the scheduler can\'t place the pod — check resources or taints.',
};

const StatCard = ({ label, value, Icon, color, bgColor }) => (
  <div className={`${bgColor} rounded-xl p-4 border border-gray-200`}>
    <div className="flex items-center justify-between">
      <div>
        <div className="flex items-center gap-1">
          <p className="text-sm font-medium text-gray-600">{label}</p>
          <Tooltip content={TOOLTIPS[label]} side="top" width="w-60">
            <HelpCircle className="w-3.5 h-3.5 text-gray-300 hover:text-gray-500 cursor-help" />
          </Tooltip>
        </div>
        <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
      </div>
      <Icon className={`w-8 h-8 ${color}`} />
    </div>
  </div>
);

const ClusterOverview = ({ data, isLoading }) => {
  if (isLoading) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-5 bg-gray-200 rounded w-1/4" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-20 bg-gray-200 rounded-xl" />)}
          </div>
        </div>
      </div>
    );
  }

  if (!data?.data) return null;

  const { summary, pods } = data.data;
  const runningPods = pods?.filter(p => p.status === 'Running').length || 0;
  const failedPods  = pods?.filter(p => ['Failed', 'CrashLoopBackOff'].includes(p.status)).length || 0;
  const pendingPods = pods?.filter(p => p.status === 'Pending').length || 0;
  const hasNoData = (summary?.totalPods ?? 0) === 0 && (summary?.totalNodes ?? 0) === 0;

  const stats = [
    { label: 'Total Pods',   value: summary?.totalPods || 0, icon: Activity,     color: 'text-blue-600',   bgColor: 'bg-blue-50' },
    { label: 'Running Pods', value: runningPods,              icon: CheckCircle,  color: 'text-green-600',  bgColor: 'bg-green-50' },
    { label: 'Total Nodes',  value: summary?.totalNodes || 0, icon: Server,       color: 'text-purple-600', bgColor: 'bg-purple-50' },
    { label: 'Issues',       value: failedPods + pendingPods, icon: AlertCircle,  color: 'text-red-600',    bgColor: failedPods + pendingPods > 0 ? 'bg-red-50' : 'bg-gray-50' },
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Cluster Overview</h2>
        {data.data.timestamp && (
          <span className="text-xs text-gray-400">
            Updated {Math.floor((Date.now() - new Date(data.data.timestamp).getTime()) / 1000)}s ago
          </span>
        )}
      </div>
      {hasNoData && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          No cluster data. These cards are live stats from the API. If you use port-forward, ensure the backend is reachable (see README). Mock mode shows zeros.
        </p>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" role="region" aria-label="Cluster stats (read-only)">
        {stats.map(s => (
          <StatCard key={s.label} label={s.label} value={s.value} Icon={s.icon} color={s.color} bgColor={s.bgColor} />
        ))}
      </div>
    </div>
  );
};

export default ClusterOverview;
