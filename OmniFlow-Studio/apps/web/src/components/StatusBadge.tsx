type StatusVariant = 'online' | 'offline' | 'warning' | 'error' | 'running' | 'success' | 'unknown' | 'blocked';

const variants: Record<StatusVariant, { dot: string; text: string; label: string }> = {
  online:   { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Online' },
  offline:  { dot: 'bg-slate-400',   text: 'text-slate-600',   label: 'Offline' },
  warning:  { dot: 'bg-amber-500',   text: 'text-amber-700',   label: 'Warning' },
  error:    { dot: 'bg-red-500',     text: 'text-red-700',     label: 'Error' },
  running:  { dot: 'bg-blue-500 animate-pulse', text: 'text-blue-700', label: 'Running' },
  success:  { dot: 'bg-emerald-500', text: 'text-emerald-700', label: 'Success' },
  unknown:  { dot: 'bg-slate-300',   text: 'text-slate-500',   label: 'Unknown' },
  blocked:  { dot: 'bg-orange-500',  text: 'text-orange-700',  label: 'Blocked' },
};

interface StatusBadgeProps {
  status: StatusVariant;
  label?: string;
  className?: string;
}

export default function StatusBadge({ status, label, className = '' }: StatusBadgeProps) {
  const v = variants[status] ?? variants.unknown;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${v.dot}`} />
      <span className={`text-xs font-medium ${v.text}`}>{label ?? v.label}</span>
    </span>
  );
}
