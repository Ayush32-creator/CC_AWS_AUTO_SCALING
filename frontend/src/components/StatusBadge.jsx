import { CircleCheck, CircleX, Clock, TimerOff } from 'lucide-react';

// Visual treatment for each order status the API can return.
export const ORDER_STATUS = {
  PAID: { label: 'Paid', tone: 'ok', icon: CircleCheck },
  PENDING: { label: 'Processing', tone: 'info', icon: Clock },
  PAYMENT_FAILED: { label: 'Payment failed', tone: 'danger', icon: CircleX },
  EXPIRED: { label: 'Expired', tone: 'muted', icon: TimerOff },
};

export default function StatusBadge({ status }) {
  const s = ORDER_STATUS[status] ?? { label: status, tone: 'muted', icon: Clock };
  const Icon = s.icon;
  return (
    <span className={`status-badge tone-${s.tone}`}>
      <Icon size={14} aria-hidden="true" />
      {s.label}
    </span>
  );
}
