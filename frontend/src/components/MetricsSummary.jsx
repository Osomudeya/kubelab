/**
 * MetricsSummary — Observability placeholder
 *
 * Real metrics come from Prometheus via Grafana.
 * Until the CPU/Memory stress simulations run and you check Grafana,
 * this card explains what Prometheus captures and where to find it.
 *
 * Grafana is exposed as NodePort 30300 on every cluster node.
 * We derive the URL from window.location.hostname so it works regardless
 * of whether the user is accessing via localhost or a real node IP.
 */

import { BarChart2, ExternalLink, AlertCircle } from 'lucide-react';

// Grafana NodePort — must match the NodePort in k8s/observability/grafana.yaml
const GRAFANA_PORT = 30300;

function getGrafanaUrl() {
  const hostname = window.location.hostname;
  return `http://${hostname}:${GRAFANA_PORT}`;
}

const MetricsSummary = ({ isLoading }) => {
  if (isLoading) return null; // Silent during load — doesn't add value

  const grafanaUrl = getGrafanaUrl();

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center flex-shrink-0">
          <BarChart2 className="w-5 h-5 text-indigo-500" />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-bold text-gray-800">Live Metrics — Prometheus + Grafana</h2>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">
            After running <strong>CPU Stress</strong> or <strong>Memory Stress</strong>, open Grafana
            to see real-time CPU throttle rate, memory usage, pod restarts, and request latency.
            These metrics come from <code className="bg-gray-100 px-1 rounded">kube-state-metrics</code> and{' '}
            <code className="bg-gray-100 px-1 rounded">node-exporter</code> — both running in the cluster now.
          </p>
          <div className="flex items-center gap-3 mt-3 flex-wrap">
            <a
              href={grafanaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
            >
              Open Grafana <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <span className="text-xs text-gray-400">Login: admin / kubelab-grafana-2026</span>
          </div>
          <p className="text-xs text-gray-400 mt-2 flex items-start gap-1">
            <AlertCircle className="w-3 h-3 mt-0.5 flex-shrink-0 text-amber-400" />
            <span>
              Grafana opens on port 30300. If it doesn&apos;t load, run{' '}
              <code className="bg-gray-100 px-1 rounded">kubectl get nodes -o wide</code>{' '}
              and visit <code className="bg-gray-100 px-1 rounded">http://&lt;node-ip&gt;:30300</code>.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default MetricsSummary;
