import { RotateCcw, TriangleAlert } from 'lucide-react';

export function Loading({ label = 'Loading…' }) {
  return (
    <p className="notice" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </p>
  );
}

export function ErrorMessage({ error, onRetry, title }) {
  if (!error) return null;
  return (
    <div className="alert" role="alert">
      <TriangleAlert size={18} className="alert-icon" aria-hidden="true" />
      <div className="alert-body">
        {title && <strong>{title}</strong>}
        <span>{error.message}</span>
      </div>
      {onRetry && (
        <button type="button" className="btn btn-ghost btn-small" onClick={onRetry}>
          <RotateCcw size={14} aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  );
}
