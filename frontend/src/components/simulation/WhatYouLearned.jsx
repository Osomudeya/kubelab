/**
 * WhatYouLearned — post-completion: observe, explanation, quiz, variant, breakers, Next.
 */
import { useState } from 'react';
import { ChevronDown, ChevronUp, ArrowRight, X, Copy, Check, ExternalLink } from 'lucide-react';
import { SIMULATIONS } from '../../data/simulations';
import { docLinks } from '../../config/docLinks';
const SIM_DOCS = {
  'kill-pod': 'pod-kill.md', 'drain-node': 'node-drain.md', 'memory-stress': 'oomkill.md',
  'db-failure': 'database.md', 'cpu-stress': 'cpu-stress.md', 'kill-all-pods': 'cascading.md', 'fail-readiness': 'readiness.md',
};
// Anchor in interview-prep.md for each sim (GitHub slug: lowercase, spaces to -, punctuation removed)
const INTERVIEW_ANCHORS = {
  'kill-pod': 'what-happens-when-a-pod-crashes',
  'drain-node': 'how-do-you-do-zero-downtime-node-maintenance',
  'cpu-stress': 'whats-the-difference-between-cpu-and-memory-limits',
  'memory-stress': 'whats-the-difference-between-cpu-and-memory-limits',
  'db-failure': 'what-is-a-statefulset-and-when-do-you-use-it',
  'kill-all-pods': 'what-is-a-poddisruptionbudget',
  'fail-readiness': 'readiness-probe-vs-liveness-probe',
};

export default function WhatYouLearned({ simId, onNext, onDismiss, exploreMode = false }) {
  const [selected, setSelected] = useState(null);
  const [observeOpen, setObserveOpen] = useState(false);
  const [copiedVariant, setCopiedVariant] = useState(false);
  const [breakersOpen, setBreakersOpen] = useState(!!exploreMode);
  const sim = SIMULATIONS[simId];
  if (!sim) return null;
  const { quiz, observe, variant, breakers, learn: metaLearn } = sim;
  const answered = selected !== null;
  const isCorrect = selected === quiz?.correct;
  const canNext = !quiz || isCorrect || exploreMode;

  const handleVariantCopy = () => {
    if (!variant) return;
    navigator.clipboard.writeText(variant.cmd).catch(() => {});
    setCopiedVariant(true);
    setTimeout(() => setCopiedVariant(false), 2000);
  };

  return (
    <div className="mt-3 bg-green-50 border border-green-300 rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between">
        <p className="text-xs font-bold text-green-800 uppercase tracking-wide">What You Just Learned</p>
        <button onClick={onDismiss} className="text-green-400 hover:text-green-600 transition-colors" aria-label="Dismiss">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      {observe && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3">
          <p className="text-xs font-bold text-amber-800 mb-1">Check your terminal first</p>
          <p className="text-xs text-amber-900 leading-relaxed mb-2">{observe.prompt}</p>
          <button onClick={() => setObserveOpen(p => !p)} className="flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-900">
            {observeOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            {observeOpen ? 'Hide answer' : 'Reveal answer'}
          </button>
          {observeOpen && <p className="mt-2 text-xs text-amber-900 leading-relaxed bg-amber-100 rounded px-2 py-1.5">{observe.reveal}</p>}
        </div>
      )}
      <div>
        <p className="text-sm text-green-900 leading-relaxed mb-3">{metaLearn.explanation}</p>
        <div className="bg-green-100 rounded-md px-3 py-2">
          <p className="text-xs font-semibold text-green-700 mb-1">In production, this means:</p>
          <p className="text-xs text-green-800 leading-relaxed">{metaLearn.production}</p>
        </div>
      </div>
      {quiz && (
        <div className="border-t border-green-200 pt-4">
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">{exploreMode ? 'Optional — test yourself' : 'Quick check — answer before moving on'}</p>
          <p className="text-sm font-medium text-gray-800 leading-snug mb-3">{quiz.q}</p>
          <div className="space-y-2">
            {quiz.options.map((opt, i) => {
              let cls = 'bg-white border-gray-200 text-gray-700 hover:border-gray-400';
              if (selected === i) cls = i === quiz.correct ? 'bg-green-100 border-green-500 text-green-900 font-medium' : 'bg-red-100 border-red-400 text-red-900';
              else if (answered && i === quiz.correct) cls = 'bg-green-50 border-green-300 text-green-800';
              return (
                <button key={i} onClick={() => !isCorrect && setSelected(i)} disabled={isCorrect} className={`w-full text-left text-xs px-3 py-2.5 rounded-lg border transition-all ${cls}`}>
                  <span className="font-mono text-gray-400 mr-2">{String.fromCharCode(65 + i)}.</span>{opt}
                </button>
              );
            })}
          </div>
          {answered && !isCorrect && <p className="text-xs text-red-600 mt-2 font-medium">Not quite — try again.</p>}
          {isCorrect && <div className="mt-3 bg-green-100 border border-green-300 rounded-lg px-3 py-2"><p className="text-xs text-green-800 leading-relaxed"><span className="font-bold">Correct! </span>{quiz.explanation}</p></div>}
        </div>
      )}
      {(canNext || exploreMode) && variant && (
        <div className="border-t border-green-200 pt-4">
          <p className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-1.5">Try This Next</p>
          <p className="text-xs font-semibold text-blue-800 mb-1">{variant.title}</p>
          <div className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2 mb-2">
            <span className="text-green-400 font-mono text-xs select-none">$</span>
            <code className="font-mono text-xs text-green-300 flex-1 break-all">{variant.cmd}</code>
            <button onClick={handleVariantCopy} className="flex-shrink-0 text-gray-500 hover:text-gray-300">{copiedVariant ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}</button>
          </div>
          <p className="text-xs text-blue-700 leading-relaxed">{variant.what}</p>
        </div>
      )}
      {(canNext || exploreMode) && breakers && (
        <div className="border-t border-green-200 pt-3">
          <button onClick={() => setBreakersOpen(p => !p)} className="flex items-center gap-1.5 text-xs font-bold text-orange-700 uppercase tracking-wide">
            {breakersOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            What Would Break This?
          </button>
          {breakersOpen && (
            <ul className="mt-2.5 space-y-3">
              {breakers.map((item, i) => (
                <li key={i} className="text-xs">
                  <p className="font-medium text-orange-800 leading-relaxed">{item.q}</p>
                  <p className="mt-1 text-gray-600 leading-relaxed pl-3 border-l-2 border-orange-200">{item.a}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {SIM_DOCS[simId] && (
        <div className="border-t border-green-200 pt-3">
          <a href={`${docLinks.simulationsBase}/${SIM_DOCS[simId]}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:text-green-800 hover:underline">Read the full guide <ExternalLink className="w-3 h-3" /></a>
        </div>
      )}
      {sim.interviewQuestion && INTERVIEW_ANCHORS[simId] && (
        <div className="border-t border-green-200 pt-3">
          <a href={`${docLinks.interviewPrep}#${INTERVIEW_ANCHORS[simId]}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 hover:underline">💼 Interview question this prepares you for → <ExternalLink className="w-3 h-3" /></a>
          <p className="text-xs text-gray-600 mt-0.5">{sim.interviewQuestion}</p>
        </div>
      )}
      <div className="border-t border-green-200 pt-3">
        <a href={docLinks.interviewPrep} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-800 hover:underline">All interview prep questions <ExternalLink className="w-3 h-3" /></a>
      </div>
      <div className="border-t border-green-200 pt-3 flex items-center gap-2 flex-wrap">
        <button onClick={onDismiss} className="text-xs px-3 py-1.5 rounded-lg border border-green-300 text-green-700 hover:bg-green-100">Got it</button>
        {sim.next && SIMULATIONS[sim.next] && canNext && (
          <button onClick={() => onNext(sim.next)} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white font-semibold">
            Next: {SIMULATIONS[sim.next].objective} <ArrowRight className="w-3 h-3" />
          </button>
        )}
        {quiz && !isCorrect && !exploreMode && <span className="text-xs text-gray-400 italic">Answer the question above to unlock Next</span>}
      </div>
    </div>
  );
}
