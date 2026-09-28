export function Labeled({ label, value, className = '' }) {
  return (
    <div className={className}>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-sm font-semibold text-neutral-900 break-words">{value}</div>
    </div>
  );
}

export function EditableNumber({ label, value, onChange }) {
  return (
    <div>
      <div className="text-xs text-neutral-500">{label}</div>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-xl border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-800 focus:border-neutral-800"
      />
    </div>
  );
}

