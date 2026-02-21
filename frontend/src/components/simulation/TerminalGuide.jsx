/**
 * TerminalGuide — before/after kubectl commands and terminal checkbox gate.
 * Content from SIMULATIONS[simId].terminal.
 */

import { useState, useCallback } from 'react';
import { Terminal, Copy, Check } from 'lucide-react';
import { SIMULATIONS } from '../../data/simulations';

const CopyBtn = ({ text }) => {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return (
    <button
      onClick={copy}
      title="Copy to clipboard"
      className="flex-shrink-0 flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border border-gray-700 text-gray-500 hover:text-gray-200 hover:border-gray-500 transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
      <span className="font-mono">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
};

export default function TerminalGuide({ simId, ready, onReady, skipGate = false }) {
  const t = SIMULATIONS[simId]?.terminal;
  if (!t) return null;

  const Step = ({ num, label, labelColor, cmd, why }) => (
    <div className="px-3 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className={`text-xs font-bold font-mono ${labelColor}`}>
          Step {num} — {label}
        </span>
      </div>
      <div className="flex items-center gap-2 bg-black/60 rounded px-3 py-2">
        <span className="text-green-500 font-mono text-xs select-none flex-shrink-0">$</span>
        <code className="font-mono text-xs text-green-300 flex-1 break-all">{cmd}</code>
        <CopyBtn text={cmd} />
      </div>
      <p className="text-xs text-gray-500 mt-1.5 pl-1 leading-relaxed">{why}</p>
    </div>
  );

  return (
    <div className="mt-3 rounded-lg overflow-hidden border border-gray-700 bg-gray-950">
      <div className="flex items-center gap-2 px-3 py-2 bg-gray-900 border-b border-gray-700">
        <Terminal className="w-3.5 h-3.5 text-green-400" />
        <span className="text-xs font-semibold text-green-300 font-mono">Your terminal</span>
        <span className="text-xs text-gray-500 font-mono">— the UI is a visual aid; this is where you really learn</span>
      </div>

      <div className="divide-y divide-gray-800/60">
        <Step num={1} label="Run this now and leave it open" labelColor="text-yellow-400" cmd={t.before.cmd} why={t.before.why} />
        {t.also && (
          <div className="px-3 py-2 bg-gray-900/30">
            <p className="text-xs text-gray-500 mb-1.5 font-mono">Optional — open a second terminal tab:</p>
            <div className="flex items-center gap-2 bg-black/40 rounded px-3 py-1.5">
              <span className="text-green-600 font-mono text-xs select-none flex-shrink-0">$</span>
              <code className="font-mono text-xs text-gray-400 flex-1 break-all">{t.also.cmd}</code>
              <CopyBtn text={t.also.cmd} />
            </div>
            <p className="text-xs text-gray-600 mt-1 pl-1">{t.also.why}</p>
          </div>
        )}
        {!skipGate && (
          <div className="px-3 py-3 bg-gray-900/70">
            <label className="flex items-start gap-3 cursor-pointer group select-none">
              <input
                type="checkbox"
                checked={!!ready}
                onChange={(e) => onReady?.(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-green-500 flex-shrink-0 cursor-pointer"
              />
              <span className={`text-xs leading-relaxed transition-colors ${ready ? 'text-green-400 font-medium' : 'text-gray-400 group-hover:text-gray-300'}`}>
                My terminal is open and streaming — I can see live output.
                {!ready && <span className="ml-1 text-yellow-500 font-semibold">(check this to unlock the Run button)</span>}
                {ready && <span className="ml-1 text-green-500">✓ Run button unlocked</span>}
              </span>
            </label>
          </div>
        )}
        <Step num={3} label="After completion — verify" labelColor="text-blue-400" cmd={t.after.cmd} why={t.after.why} />
      </div>
    </div>
  );
}
