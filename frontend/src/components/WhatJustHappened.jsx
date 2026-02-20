/**
 * WhatJustHappened — Narrative activity log
 *
 * Shows a narrative timeline of every simulation action with emojis,
 * plain-language explanations, and cause→effect framing.
 * Position: immediately below SimulationPanel.
 */

import { useState } from 'react';
import { Trash2 } from 'lucide-react';

const MAX_VISIBLE = 5;

// Map emoji to a subtle background tint
const ENTRY_STYLE = {
  '🔴': 'border-l-red-400 bg-red-50/50',
  '✅': 'border-l-green-400 bg-green-50/50',
  '⚠️': 'border-l-yellow-400 bg-yellow-50/40',
  '⏳': 'border-l-blue-300 bg-blue-50/40',
};

const Entry = ({ entry }) => {
  const style = ENTRY_STYLE[entry.emoji] || 'border-l-gray-300 bg-gray-50/40';
  return (
    <div className={`border-l-2 pl-3 py-1.5 ${style}`}>
      <div className="flex items-baseline gap-2">
        <span className="text-base leading-none flex-shrink-0">{entry.emoji}</span>
        <span className="text-xs font-mono text-gray-400 flex-shrink-0">{entry.time}</span>
        <span className="text-sm font-semibold text-gray-800">{entry.label}</span>
        {entry.detail && (
          <span className="text-xs text-gray-500 truncate">{entry.detail}</span>
        )}
      </div>
      {entry.narrative?.explanation && (
        <p className="text-xs text-gray-500 mt-0.5 ml-6 leading-relaxed">
          {entry.narrative.explanation}
        </p>
      )}
    </div>
  );
};

const WhatJustHappened = ({ entries, onClear }) => {
  const [showAll, setShowAll] = useState(false);

  if (!entries || entries.length === 0) return null;

  const visible  = showAll ? entries : entries.slice(0, MAX_VISIBLE);
  const overflow = entries.length - MAX_VISIBLE;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-bold text-gray-800">What Just Happened</h2>
          <p className="text-xs text-gray-400 mt-0.5">Cause → effect for every action this session</p>
        </div>
        <button
          onClick={onClear}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" /> Clear
        </button>
      </div>

      <div className="space-y-2">
        {visible.map(e => <Entry key={e.id} entry={e} />)}
      </div>

      {overflow > 0 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-2 text-xs text-blue-500 hover:text-blue-700 transition-colors"
        >
          Show {overflow} older event{overflow !== 1 ? 's' : ''} ›
        </button>
      )}
      {showAll && entries.length > MAX_VISIBLE && (
        <button
          onClick={() => setShowAll(false)}
          className="mt-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Collapse ‹
        </button>
      )}
    </div>
  );
};

export default WhatJustHappened;

