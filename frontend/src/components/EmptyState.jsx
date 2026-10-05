import { m } from 'framer-motion';

export default function EmptyState({ icon: Icon, title, children, action, tone = 'neutral' }) {
  return (
    <m.div
      className={`empty empty-${tone}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      {Icon && (
        <div className="empty-icon">
          <Icon size={28} aria-hidden="true" />
        </div>
      )}
      <h2>{title}</h2>
      {children && <div className="empty-text">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </m.div>
  );
}
