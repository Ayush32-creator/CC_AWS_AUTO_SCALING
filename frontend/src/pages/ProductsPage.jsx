import { useCallback, useEffect, useState } from 'react';
import { useCart } from '../cart/CartContext.jsx';
import { MAX_QUANTITY } from '../cart/cartReducer.js';
import { ErrorMessage, Loading } from '../components/Status.jsx';
import { api } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';

function ProductImage({ product }) {
  if (product.imageUrl) return <img className="thumb" src={product.imageUrl} alt="" />;
  // No image hosting needed: a deterministic coloured tile per product.
  const hue = (product.id * 47) % 360;
  const initials = product.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
  return (
    <div className="thumb" style={{ '--hue': hue }} aria-hidden="true">
      {initials}
    </div>
  );
}

export default function ProductsPage() {
  const { items: cartItems, add } = useCart();
  const [products, setProducts] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api
      .listProducts()
      .then((data) => setProducts(data.items))
      .catch(setError);
  }, []);

  useEffect(load, [load]);

  if (error) return <ErrorMessage error={error} onRetry={load} />;
  if (!products) return <Loading label="Loading products…" />;

  return (
    <section>
      <h1>Products</h1>
      <div className="grid">
        {products.map((p) => {
          const inCart = cartItems.find((i) => i.productId === p.id)?.quantity ?? 0;
          const atLimit = inCart >= Math.min(p.stock, MAX_QUANTITY);
          return (
            <article key={p.id} className="card">
              <ProductImage product={p} />
              <h2>{p.name}</h2>
              <p className="muted">{p.description}</p>
              <div className="card-footer">
                <strong>{formatMoney(p.priceCents)}</strong>
                <span className={p.stock === 0 ? 'stock out' : p.stock <= 5 ? 'stock low' : 'stock'}>
                  {p.stock === 0 ? 'Out of stock' : p.stock <= 5 ? `Only ${p.stock} left` : 'In stock'}
                </span>
              </div>
              <button type="button" className="btn" disabled={p.stock === 0 || atLimit} onClick={() => add(p)}>
                {inCart > 0 ? `Add another (${inCart} in cart)` : 'Add to cart'}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
