import { Link, NavLink, Route, Routes } from 'react-router-dom';
import { useCart } from './cart/CartContext.jsx';
import InstanceBadge from './components/InstanceBadge.jsx';
import CartPage from './pages/CartPage.jsx';
import CheckoutPage from './pages/CheckoutPage.jsx';
import OrderPage from './pages/OrderPage.jsx';
import ProductsPage from './pages/ProductsPage.jsx';

export default function App() {
  const { count } = useCart();

  return (
    <div className="layout">
      <header className="header">
        <Link to="/" className="brand">
          Cloud<span>Cart</span>
        </Link>
        <nav>
          <NavLink to="/" end>
            Products
          </NavLink>
          <NavLink to="/cart" aria-label={`Cart, ${count} items`}>
            Cart <span className="badge">{count}</span>
          </NavLink>
        </nav>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<ProductsPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/orders/:id" element={<OrderPage />} />
          <Route path="*" element={<p className="notice">Page not found. <Link to="/">Back to products</Link></p>} />
        </Routes>
      </main>

      <footer className="footer">
        <span>Auto-Scaling Checkout · Cloud Computing course project</span>
        <InstanceBadge />
      </footer>
    </div>
  );
}
