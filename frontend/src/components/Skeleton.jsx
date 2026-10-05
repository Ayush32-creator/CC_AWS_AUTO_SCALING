export function ProductGridSkeleton({ count = 8 }) {
  return (
    <div className="grid" aria-busy="true">
      <span className="sr-only" role="status">
        Loading products…
      </span>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card card-skeleton" aria-hidden="true">
          <div className="sk sk-media" />
          <div className="card-body">
            <div className="sk sk-line" style={{ width: '40%' }} />
            <div className="sk sk-line sk-title" style={{ width: '75%' }} />
            <div className="sk sk-line" />
            <div className="sk sk-line" style={{ width: '60%' }} />
            <div className="sk sk-btn" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function PanelSkeleton({ label = 'Loading…' }) {
  return (
    <div className="panel panel-skeleton" aria-busy="true">
      <span className="sr-only" role="status">
        {label}
      </span>
      <div className="sk sk-line sk-title" style={{ width: '45%' }} />
      <div className="sk sk-line" />
      <div className="sk sk-line" style={{ width: '80%' }} />
      <div className="sk sk-line" style={{ width: '65%' }} />
    </div>
  );
}
