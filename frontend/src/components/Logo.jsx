import { Link } from 'react-router-dom';

/** NEXORA mark: a single-stroke "N" with a signal dot, plus the wordmark. */
export function LogoMark({ size = 32 }) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="var(--logo-bg)" />
      <path d="M9.5 22.5v-13l13 13v-13" fill="none" stroke="var(--logo-fg)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24.5" cy="7.5" r="2.2" fill="var(--logo-dot)" />
    </svg>
  );
}

export default function Logo({ onClick }) {
  return (
    <Link to="/" className="logo" aria-label="NEXORA home" onClick={onClick}>
      <LogoMark />
      <span className="logo-word">NEXORA</span>
    </Link>
  );
}
