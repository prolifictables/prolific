export function formatCentsToNgn(
  amountCents: number,
  currencySymbol = '₦'
): string {
  const amount = Math.round(amountCents) / 100;
  const formatted = new Intl.NumberFormat('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${currencySymbol}${formatted}`;
}

export function padZero(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatDate(ts: number | Date | string | undefined | null): string {
  if (!ts) return '--';
  const d = typeof ts === 'number' ? new Date(ts) : ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTime(ts: number | Date | string | undefined | null): string {
  if (!ts) return '--:--';
  const d = typeof ts === 'number' ? new Date(ts) : ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleTimeString('en-NG', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatDateTime(ts: number | Date | string | undefined | null): string {
  return `${formatDate(ts)} ${formatTime(ts)}`;
}

export type StatusColorVariant =
  | 'emerald'
  | 'amber'
  | 'red'
  | 'rose'
  | 'indigo'
  | 'slate';

export function statusVariant(
  status: string
): {
  bg: string;
  ring: string;
  text: string;
  dot: string;
  label: string;
} {
  switch ((status || '').toUpperCase()) {
    case 'ONLINE':
    case 'AVAILABLE':
    case 'PAID':
    case 'COMPLETED':
    case 'OPEN':
      return {
        bg: 'bg-emerald-500/15',
        ring: 'ring-emerald-500/25',
        text: 'text-emerald-300',
        dot: 'bg-emerald-400',
        label: status,
      };
    case 'OFFLINE':
      return {
        bg: 'bg-red-500/15',
        ring: 'ring-red-500/25',
        text: 'text-red-300',
        dot: 'bg-red-400',
        label: status,
      };
    case 'SYNCHRONIZING':
    case 'PENDING':
    case 'PREPARING':
    case 'SYNCING':
      return {
        bg: 'bg-amber-500/15',
        ring: 'ring-amber-500/25',
        text: 'text-amber-300',
        dot: 'bg-amber-400 animate-pulse-soft',
        label: status,
      };
    case 'SYNC_ERROR':
    case 'FAILED':
    case 'OUT_OF_STOCK':
    case 'OOS':
    case 'ERROR':
      return {
        bg: 'bg-rose-500/15',
        ring: 'ring-rose-500/25',
        text: 'text-rose-300',
        dot: 'bg-rose-400',
        label: status,
      };
    case 'OFFLINE_PIN':
      return {
        bg: 'bg-indigo-500/15',
        ring: 'ring-indigo-500/25',
        text: 'text-indigo-300',
        dot: 'bg-indigo-400',
        label: 'Offline',
      };
    default:
      return {
        bg: 'bg-slate-500/15',
        ring: 'ring-slate-500/25',
        text: 'text-slate-300',
        dot: 'bg-slate-400',
        label: status || 'UNKNOWN',
      };
  }
}
