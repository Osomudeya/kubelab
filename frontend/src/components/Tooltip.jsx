/**
 * Tooltip — hover popover for contextual help
 * Usage: <Tooltip content="explanation"><HelpCircle /></Tooltip>
 */

const Tooltip = ({ content, children, side = 'top', width = 'w-52' }) => (
  <span className="relative group inline-flex items-center">
    {children}
    <span className={`
      absolute z-30 ${width} bg-gray-900 text-white text-xs rounded-lg px-3 py-2 leading-relaxed
      pointer-events-none select-none
      invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-all duration-150
      ${side === 'top'    ? 'bottom-full left-1/2 -translate-x-1/2 mb-2' : ''}
      ${side === 'bottom' ? 'top-full left-1/2 -translate-x-1/2 mt-2'   : ''}
      ${side === 'right'  ? 'left-full top-1/2 -translate-y-1/2 ml-2'   : ''}
      ${side === 'left'   ? 'right-full top-1/2 -translate-y-1/2 mr-2'  : ''}
    `}>
      {content}
    </span>
  </span>
);

export default Tooltip;

