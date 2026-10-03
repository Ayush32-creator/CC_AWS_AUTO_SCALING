import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../cart/CartContext.jsx';
import { MAX_QUANTITY } from '../cart/cartReducer.js';
import { ErrorMessage } from '../components/Status.jsx';
import { api } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';

export default function CartPage() {
  const { items, subtotalCents, setQuantity, remove } = useCart();
  const navigate = useNavigate();
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState(null);

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
  }, [cartKey]);

  if (items.length === 0) {
    return (
      <section>
        <h1>Your cart</h1>
        <p className="notice">
          Your cart is empty. <Link to="/">Browse products</Link>
        </p>
      </section>
    );
  }

  const total = quote?.subtotalCents ?? subtotalCents;
  const blocked = quote?.items.some((l) => !l.available);

  return (
    <section>
      <h1>Your cart</h1>
      <ErrorMessage error={error} />
      <table className="table">
        <thead>
          <tr>
            <th>Product</th>
            <th>Price</th>
            <th>Qty</th>
            <th className="num">Total</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {items.map((i) => {
            const line = quote?.items.find((l) => l.productId === i.productId);
            const price = line?.unitPriceCents ?? i.priceCents;
            return (
              <tr key={i.productId}>
                <td>
                  {i.name}
                  {line && !line.available && <div className="stock out">Only {line.stock} available</div>}
                </td>
                <td>{formatMoney(price)}</td>
                <td>
                  <input
                    type="number"
                    min="1"
                    max={Math.min(MAX_QUANTITY, i.stock ?? MAX_QUANTITY)}
                    value={i.quantity}
                    aria-label={`Quantity of ${i.name}`}
                    onChange={(e) => setQuantity(i.productId, Number(e.target.value) || 1)}
                  />
                </td>
                <td className="num">{formatMoney(price * i.quantity)}</td>
                <td>
                  <button type="button" className="btn-link" onClick={() => remove(i.productId)}>
                    Remove
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="summary">
        <span>
          Subtotal <strong>{formatMoney(total)}</strong>
        </span>
        <button type="button" className="btn" disabled={blocked || !!error} onClick={() => navigate('/checkout')}>
          Proceed to checkout
        </button>
      </div>
    </section>
  );
}
