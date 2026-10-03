export function Loading({ label = 'Loading…' }) {
  return (
    <p className="notice" role="status">
      {label}
    </p>
  );
}

export function ErrorMessage({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="alert" role="alert">
      <span>{error.message}</span>
      {onRetry && (
        <button type="button" className="btn btn-small" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}
