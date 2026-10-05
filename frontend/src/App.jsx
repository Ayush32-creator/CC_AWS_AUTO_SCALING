import { useEffect } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { LazyMotion, MotionConfig, domAnimation } from 'framer-motion';
import { Compass } from 'lucide-react';
import EmptyState from './components/EmptyState.jsx';
import Footer from './components/Footer.jsx';
import Navbar from './components/Navbar.jsx';
import { ToastProvider } from './components/Toast.jsx';
import CartPage from './pages/CartPage.jsx';
import CheckoutPage from './pages/CheckoutPage.jsx';
import OrderPage from './pages/OrderPage.jsx';
import ProductsPage from './pages/ProductsPage.jsx';

/** Scroll to the top on page changes, or to the #section in the URL. */
function useScrollRestoration() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    const target = hash && document.getElementById(hash.slice(1));
    if (target) target.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    else document.scrollingElement?.scrollTo?.(0, 0);
  }, [pathname, hash]);
}

function NotFound() {
  return (
    <section className="page">
      <EmptyState
        icon={Compass}
        title="Page not found"
        action={
          <Link to="/" className="btn btn-primary">
            Back to products
          </Link>
        }
      >
        <p>The page you are looking for doesn't exist or has moved.</p>
      </EmptyState>
    </section>
  );
}

export default function App() {
  useScrollRestoration();

  return (
    // domAnimation keeps the animation bundle small; reducedMotion respects the OS setting.
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <ToastProvider>
          <div className="layout">
            <a href="#main" className="skip-link">
              Skip to content
            </a>
            <Navbar />
            <main id="main" className="main container">
              <Routes>
                <Route path="/" element={<ProductsPage />} />
                <Route path="/cart" element={<CartPage />} />
                <Route path="/checkout" element={<CheckoutPage />} />
                <Route path="/orders/:id" element={<OrderPage />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </main>
            <Footer />
          </div>
        </ToastProvider>
      </MotionConfig>
    </LazyMotion>
  );
}
