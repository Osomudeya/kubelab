/**
 * SimCard — individual simulation card (title row + expanded body).
 * When another sim is RUNNING or OBSERVING, only that card can be expanded (parent passes canExpand).
 */

import { ChevronDown, ChevronUp, CheckCircle2, Loader2, Trash2, ServerOff, Cpu, HardDrive, Database, Eye } from 'lucide-react';
import { SIMULATIONS } from '../../data/simulations';

const ICON_MAP = { Trash2, ServerOff, Cpu, HardDrive, Database, Eye };

const ACCENT_MAP = { red: 'border-red-400 bg-red-50', orange: 'border-orange-400 bg-orange-50', yellow: 'border-yellow-400 bg-yellow-50', rose: 'border-rose-500 bg-rose-50', purple: 'border-purple-400 bg-purple-50' };

export default function SimCard({
  simId,
  isExpanded,
  isCompleted,
  isActive,
  isDimmed,
  canExpand,
  label,
  isLoading,
  children,
  onToggle,
}) {
  const sim = SIMULATIONS[simId];
  if (!sim) return null;
  const Icon = ICON_MAP[sim.icon] || Cpu;
  const accent = ACCENT_MAP[sim.accentColor] || ACCENT_MAP.red;

  const handleClick = () => {
    if (!canExpand && !isExpanded) return;
    onToggle?.();
  };

  return (
    <div
      id={`sim-${simId}`}
      className={`rounded-xl border-2 transition-all duration-300 ${isExpanded ? accent : 'border-gray-200 bg-white'} ${isDimmed ? 'opacity-50' : 'opacity-100'}`}
    >
      <button
        type="button"
        className="w-full flex items-center gap-3 p-4 text-left"
        onClick={handleClick}
        aria-expanded={isExpanded}
        aria-label={`Simulation ${sim.number}: ${sim.label} — ${isCompleted ? 'complete' : 'not yet completed'}`}
        title={sim.label}
      >
        <span
          className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
            isCompleted ? 'bg-green-500 text-white' : isExpanded ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'
          }`}
        >
          {isCompleted ? <CheckCircle2 className="w-4 h-4" /> : sim.number}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-gray-900">{label}</span>
            {sim.startHere && !isCompleted && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-semibold">Start here →</span>
            )}
            {isActive && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-semibold animate-pulse">Running…</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            <span className="font-medium text-gray-400">Learn:</span> {sim.objective}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isLoading ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : <Icon className="w-4 h-4 text-gray-400" />}
          {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-gray-100 pt-3">
          {children}
        </div>
      )}
    </div>
  );
}
