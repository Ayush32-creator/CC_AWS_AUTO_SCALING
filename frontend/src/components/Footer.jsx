import { Link } from 'react-router-dom';
import InstanceBadge from './InstanceBadge.jsx';
import { LogoMark } from './Logo.jsx';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <Link to="/" className="logo logo-on-dark" aria-label="NEXORA home">
            <LogoMark />
            <span className="logo-word">NEXORA</span>
          </Link>
          <p>
            A curated store for focused desks, and the storefront of an auto-scaling checkout on AWS: EC2 Auto Scaling
            behind an Application Load Balancer, with PostgreSQL on Amazon RDS.
          </p>
        </div>

        <nav className="footer-col" aria-label="Shop">
          <h3>Shop</h3>
          <Link to="/#catalogue">All products</Link>
          <Link to="/cart">Your cart</Link>
          <Link to="/checkout">Checkout</Link>
        </nav>

        <div className="footer-col">
          <h3>How checkout works</h3>
          <p>Prices and stock confirmed by the server</p>
          <p>Retry-safe orders with idempotency keys</p>
          <p>Mock payments, with no real charge</p>
        </div>

        <div className="footer-col">
          <h3>Demo cards</h3>
          <p>
            <code>4242 4242 4242 4242</code> approves
          </p>
          <p>
            <code>4000 0000 0000 0002</code> declines
          </p>
        </div>
      </div>

      <div className="container footer-bottom">
        <span>© {new Date().getFullYear()} NEXORA · Auto-Scaling Checkout · Cloud Computing course project</span>
        <InstanceBadge />
      </div>
    </footer>
  );
}
