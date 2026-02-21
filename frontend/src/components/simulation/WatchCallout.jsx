import { Eye } from 'lucide-react';

export default function WatchCallout({ items }) {
  if (!items?.length) return null;
  return (
    <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3">
      <p className="text-xs font-semibold text-blue-700 flex items-center gap-1 mb-1.5">
        <Eye className="w-3.5 h-3.5" /> Watch now
      </p>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-blue-700 flex items-start gap-1.5">
            <span className="mt-0.5 text-blue-400">›</span> {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
