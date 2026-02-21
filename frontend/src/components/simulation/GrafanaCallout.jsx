/**
 * GrafanaCallout — "Open Grafana and watch this panel" for cpu-stress, memory-stress, kill-all-pods.
 */

import { ExternalLink } from 'lucide-react';
import { SIMULATIONS } from '../../data/simulations';
import { getGrafanaUrl } from '../../utils/grafana';

export default function GrafanaCallout({ simId }) {
  const grafana = SIMULATIONS[simId]?.grafana;
  if (!grafana) return null;
  const url = getGrafanaUrl();
  return (
    <div className="mt-3 p-3 rounded-lg border border-indigo-200 bg-indigo-50/80">
      <p className="text-xs font-semibold text-indigo-800 mb-1">Watch in Grafana</p>
      <p className="text-xs text-indigo-700 mb-2">
        <span className="font-medium">{grafana.panel}</span> — {grafana.what}
      </p>
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800">
        Open Grafana <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}
