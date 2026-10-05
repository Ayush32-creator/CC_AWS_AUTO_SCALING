import { useState } from 'react';
import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { useCart } from './cart/CartContext.jsx';
import InstanceBadge from './components/InstanceBadge.jsx';
import CartPage from './pages/CartPage.jsx';
import CheckoutPage from './pages/CheckoutPage.jsx';
import OrderPage from './pages/OrderPage.jsx';
import ProductsPage from './pages/ProductsPage.jsx';

export default function App() {
  const { count } = useCart();
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <div className="layout">
      <header className="site-header">
        <div className="container header-inner">
          <Link to="/" className="brand" aria-label="NEXORA home">
            <span className="brand-mark">N</span>
            <span className="brand-text">NEXORA</span>
          </Link>

          <label className="header-search" aria-label="Search products">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M10.5 3a7.5 7.5 0 015.9 12.8l4.9 4.9 1.4-1.4-4.9-4.9A7.5 7.5 0 1110.5 3zm0 2a5.5 5.5 0 100 11 5.5 5.5 0 000-11z" />
            </svg>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search products"
              aria-label="Search products"
            />
          </label>

          <nav className="main-nav" aria-label="Main navigation">
            <NavLink to="/" end className="nav-link">
              Shop
            </NavLink>
            <NavLink to="/cart" className="nav-link cart-pill" aria-label={`Cart, ${count} items`}>
              <span>Cart</span>
              <span className="cart-badge">{count}</span>
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<ProductsPage searchQuery={searchQuery} setSearchQuery={setSearchQuery} />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/orders/:id" element={<OrderPage />} />
          <Route path="*" element={<p className="notice">Page not found. <Link to="/">Back to products</Link></p>} />
        </Routes>
      </main>

      <footer className="site-footer">
        <div className="container footer-inner">
          <div>
            <div className="footer-brand">NEXORA</div>
            <p>Built for resilient, scalable commerce.</p>
          </div>

          <div className="footer-links">
            <span>Shop</span>
            <span>Support</span>
            <span>About</span>
            <span>Technology</span>
          </div>

          <InstanceBadge />
        </div>
      </footer>
    </div>
  );
}
