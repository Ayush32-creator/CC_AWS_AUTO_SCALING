import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Menu, ShoppingBag, X } from 'lucide-react';
import { AnimatePresence, m } from 'framer-motion';
import { useCart } from '../cart/CartContext.jsx';
import Logo from './Logo.jsx';
import SearchBar from './SearchBar.jsx';

const LINKS = [
  { to: '/', label: 'Shop', end: true },
  { to: '/#catalogue', label: 'Collection' },
  { to: '/#why', label: 'Why NEXORA' },
];

export default function Navbar() {
  const { count } = useCart();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [menuOpen, setMenuOpen] = useState(false);
  const urlQuery = params.get('q') ?? '';
  const [query, setQuery] = useState(urlQuery);
  const inputRef = useRef(null);

  const onHome = pathname === '/';

  useEffect(() => setMenuOpen(false), [pathname]);

  // The box owns its text so fast typing is never lost to the router's deferred
  // URL updates; it only follows the URL when the change came from elsewhere
  // (Clear filters, back/forward navigation).
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setQuery(urlQuery);
  }, [urlQuery]);

  // On the products page the search filters live through ?q=; elsewhere it
  // searches when submitted.
  const changeQuery = (value) => {
    setQuery(value);
    if (!onHome) return;
    setParams(value ? { q: value } : {}, { replace: true });
    const catalogue = document.getElementById('catalogue');
    if (value && catalogue && catalogue.getBoundingClientRect().top > window.innerHeight * 0.6) {
      catalogue.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  };
  const submitQuery = (value) => {
    const q = value.trim();
    navigate(q ? `/?q=${encodeURIComponent(q)}#catalogue` : '/#catalogue');
  };

  return (
    <header className="nav">
      <div className="nav-inner container">
        <Logo />

        <nav className="nav-links" aria-label="Main">
          {LINKS.map((l) =>
            // Only "Shop" is a page; the others jump to a section of it.
            l.end ? (
              <NavLink key={l.to} to={l.to} end className="nav-link">
                {l.label}
              </NavLink>
            ) : (
              <Link key={l.to} to={l.to} className="nav-link">
                {l.label}
              </Link>
            ),
          )}
        </nav>

        <SearchBar
          className="nav-search"
          inputRef={inputRef}
          value={query}
          onChange={changeQuery}
          onSubmit={submitQuery}
        />

        <div className="nav-actions">
          <NavLink to="/cart" className="cart-link" aria-label={`Cart, ${count} items`}>
            <ShoppingBag size={20} aria-hidden="true" />
            <span className="cart-link-text">Cart</span>
            <AnimatePresence initial={false} mode="popLayout">
              <m.span
                key={count}
                className={`cart-count ${count === 0 ? 'is-zero' : ''}`}
                initial={{ scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                aria-hidden="true"
              >
                {count}
              </m.span>
            </AnimatePresence>
          </NavLink>
          <button
            type="button"
            className="icon-btn nav-menu-btn"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <m.nav
            id="mobile-menu"
            className="mobile-menu"
            aria-label="Mobile"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            {LINKS.map((l) => (
              <Link key={l.to} to={l.to} className="mobile-link" onClick={() => setMenuOpen(false)}>
                {l.label}
              </Link>
            ))}
            <Link to="/cart" className="mobile-link" onClick={() => setMenuOpen(false)}>
              Your cart ({count})
            </Link>
          </m.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
