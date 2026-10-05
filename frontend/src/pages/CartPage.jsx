import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../cart/CartContext.jsx';
import { MAX_QUANTITY } from '../cart/cartReducer.js';
import ProductImage from '../components/ProductImage.jsx';
import { ErrorMessage } from '../components/Status.jsx';
import { api } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';

export default function CartPage() {
  const { items, subtotalCents, setQuantity, remove } = useCart();
  const navigate = useNavigate();
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState(null);

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
  }, [cartKey]);

  if (items.length === 0) {
    return (
      <section className="cart-page">
        <div className="empty-state empty-state--wide">
          <div className="empty-state__icon">🛒</div>
          <h1>Your cart</h1>
          <p>Your cart is waiting for something great.</p>
          <Link to="/" className="btn btn-primary">
            Explore products
          </Link>
        </div>
      </section>
    );
  }

  const total = quote?.subtotalCents ?? subtotalCents;
  const blocked = quote?.items.some((line) => !line.available);

  return (
    <section className="cart-page">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Your cart</p>
          <h1>{items.length} {items.length === 1 ? 'item' : 'items'}</h1>
        </div>
      </div>

      <ErrorMessage error={error} />

      <div className="cart-layout">
        <div className="cart-lines">
          {items.map((item) => {
            const line = quote?.items.find((entry) => entry.productId === item.productId);
            const price = line?.unitPriceCents ?? item.priceCents;
            return (
              <article key={item.productId} className="cart-line">
                <div className="cart-line__media">
                  <ProductImage product={{ id: item.productId, name: item.name }} />
                </div>

                <div className="cart-line__content">
                  <div className="cart-line__header">
                    <h3>{item.name}</h3>
                    <button type="button" className="text-btn text-btn--danger" onClick={() => remove(item.productId)}>
                      Remove
                    </button>
                  </div>

                  {line && !line.available && <div className="stock stock--out">Only {line.stock} available</div>}

                  <div className="cart-line__controls">
                    <label className="qty-control">
                      <span>Qty</span>
                      <input
                        type="number"
                        min="1"
                        max={Math.min(MAX_QUANTITY, item.stock ?? MAX_QUANTITY)}
                        value={item.quantity}
                        aria-label={`Quantity of ${item.name}`}
                        onChange={(event) => setQuantity(item.productId, Number(event.target.value) || 1)}
                      />
                    </label>
                    <strong>{formatMoney(price * item.quantity)}</strong>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <aside className="panel summary-panel">
          <p className="eyebrow eyebrow--compact">Order summary</p>
          <div className="summary-row">
            <span>Subtotal</span>
            <strong>{formatMoney(total)}</strong>
          </div>
          <button type="button" className="btn btn-primary btn-wide" disabled={blocked || !!error} onClick={() => navigate('/checkout')}>
            Proceed to checkout
          </button>
        </aside>
      </div>
    </section>
  );
}
