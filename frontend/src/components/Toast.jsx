import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { CircleCheck, X } from 'lucide-react';
import { Link } from 'react-router-dom';

const ToastContext = createContext(null);
const TIMEOUT_MS = 3200;

/** Lightweight notifications (e.g. "added to cart"); newest on top, max 3. */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const notify = useCallback(
    ({ message, link }) => {
      const id = nextId.current++;
      setToasts((list) => [{ id, message, link }, ...list].slice(0, 3));
      setTimeout(() => dismiss(id), TIMEOUT_MS);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <m.div
              key={t.id}
              className="toast"
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              <CircleCheck size={18} className="toast-icon" aria-hidden="true" />
              <span className="toast-msg">{t.message}</span>
              {t.link && (
                <Link to={t.link.to} className="toast-link" onClick={() => dismiss(t.id)}>
                  {t.link.label}
                </Link>
              )}
              <button type="button" className="icon-btn icon-btn-sm" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
                <X size={14} aria-hidden="true" />
              </button>
            </m.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
