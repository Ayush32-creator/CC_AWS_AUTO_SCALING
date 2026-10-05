import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, m } from 'framer-motion';
import { ArrowLeft, ArrowRight, CircleCheck, Loader, ShoppingBag, Trash2, TriangleAlert } from 'lucide-react';
import { useCart } from '../cart/CartContext.jsx';
import { MAX_QUANTITY } from '../cart/cartReducer.js';
import EmptyState from '../components/EmptyState.jsx';
import ProductImage from '../components/ProductImage.jsx';
import QuantityStepper from '../components/QuantityStepper.jsx';
import { ErrorMessage } from '../components/Status.jsx';
import { api } from '../lib/api.js';
import { useCatalogLookup } from '../lib/catalog.js';
import { formatMoney } from '../lib/money.js';

export default function CartPage() {
  const { items, count, subtotalCents, setQuantity, remove } = useCart();
  const navigate = useNavigate();
  const catalog = useCatalogLookup();
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  // Ask the server for authoritative prices and stock whenever the cart changes.
  const cartKey = items.map((i) => `${i.productId}:${i.quantity}`).join(',');
  useEffect(() => {
    if (items.length === 0) return undefined;
    let cancelled = false;
    setError(null);
    api
      .quoteCart(items.map(({ productId, quantity }) => ({ productId, quantity })))
      .then((q) => !cancelled && setQuote(q))
      .catch((e) => !cancelled && setError(e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartKey, attempt]);

  if (items.length === 0) {
    return (
      <section className="page">
        <h1 className="page-title">Your cart</h1>
        <EmptyState
          icon={ShoppingBag}
          title="Your cart is empty"
          action={
            <Link to="/#catalogue" className="btn btn-primary">
              Browse products <ArrowRight size={16} aria-hidden="true" />
            </Link>
          }
        >
          <p>Find something for your desk. Your cart is saved in this browser.</p>
        </EmptyState>
      </section>
    );
  }

  const total = quote?.subtotalCents ?? subtotalCents;
  const blocked = quote?.items.some((l) => !l.available);
  const quoteFresh = quote && quote.items.map((l) => `${l.productId}:${l.quantity}`).join(',') === cartKey;

  return (
    <section className="page">
      <div className="page-head">
        <h1 className="page-title">Your cart</h1>
        <span className="muted">
          {count} {count === 1 ? 'item' : 'items'}
        </span>
      </div>

      <div className="cart-layout">
        <div className="cart-lines">
          <ErrorMessage error={error} onRetry={() => setAttempt((a) => a + 1)} title="We couldn't confirm prices." />
          <ul className="line-list">
            <AnimatePresence initial={false}>
              {items.map((i) => {
                const line = quote?.items.find((l) => l.productId === i.productId);
                const price = line?.unitPriceCents ?? i.priceCents;
                const product = catalog.get(i.productId);
                return (
                  <m.li
                    key={i.productId}
                    className="cart-line"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -24, transition: { duration: 0.2 } }}
                    transition={{ duration: 0.25 }}
                  >
                    <ProductImage
                      sku={product?.sku}
                      imageUrl={product?.imageUrl}
                      name={i.name}
                      className="thumb"
                      decorative
                    />
                    <div className="cart-line-info">
                      <span className="cart-line-name">{i.name}</span>
                      <span className="muted small">{formatMoney(price)} each</span>
                      {line && !line.available && (
                        <span className="stock-warn">
                          <TriangleAlert size={14} aria-hidden="true" /> Only {line.stock} available
                        </span>
                      )}
                    </div>
                    <QuantityStepper
                      name={i.name}
                      value={i.quantity}
                      max={Math.min(MAX_QUANTITY, i.stock ?? MAX_QUANTITY)}
                      onChange={(q) => setQuantity(i.productId, q)}
                    />
                    <span className="cart-line-total">{formatMoney(price * i.quantity)}</span>
                    <button
                      type="button"
                      className="icon-btn icon-btn-danger"
                      aria-label={`Remove ${i.name}`}
                      onClick={() => remove(i.productId)}
                    >
                      <Trash2 size={18} aria-hidden="true" />
                    </button>
                  </m.li>
                );
              })}
            </AnimatePresence>
          </ul>
          <Link to="/#catalogue" className="btn-link back-link">
            <ArrowLeft size={16} aria-hidden="true" /> Continue shopping
          </Link>
        </div>

        <aside className="panel summary-panel" aria-label="Order summary">
          <h2>Summary</h2>
          <dl className="totals">
            <div>
              <dt>Items</dt>
              <dd>{count}</dd>
            </div>
            <div className="totals-grand">
              <dt>Subtotal</dt>
              <dd>{formatMoney(total)}</dd>
            </div>
          </dl>
          <p className={`verify ${quoteFresh ? 'is-ok' : ''}`}>
            {quoteFresh ? (
              <>
                <CircleCheck size={16} aria-hidden="true" /> Prices and stock confirmed by the server
              </>
            ) : error ? (
              <>
                <TriangleAlert size={16} aria-hidden="true" /> Prices not confirmed yet
              </>
            ) : (
              <>
                <Loader size={16} className="spin" aria-hidden="true" /> Checking prices and stock…
              </>
            )}
          </p>
          {blocked && <p className="stock-warn">Reduce the highlighted quantities to continue.</p>}
          <button
            type="button"
            className="btn btn-primary btn-wide btn-lg"
            disabled={blocked || !!error}
            onClick={() => navigate('/checkout')}
          >
            Proceed to checkout
          </button>
        </aside>
      </div>
    </section>
  );
}
