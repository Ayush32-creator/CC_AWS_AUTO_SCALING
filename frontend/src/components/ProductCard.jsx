import { m } from 'framer-motion';
import { Check, ShoppingBag } from 'lucide-react';
import { MAX_QUANTITY } from '../cart/cartReducer.js';
import { formatMoney } from '../lib/money.js';
import ProductImage from './ProductImage.jsx';

export const cardVariants = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
};

function stockInfo(stock) {
  if (stock === 0) return { label: 'Out of stock', tone: 'out' };
  if (stock <= 5) return { label: `Only ${stock} left`, tone: 'low' };
  return { label: 'In stock', tone: 'ok' };
}

export default function ProductCard({ product: p, inCart, onAdd }) {
  const stock = stockInfo(p.stock);
  const atLimit = inCart >= Math.min(p.stock, MAX_QUANTITY);
  const soldOut = p.stock === 0;

  let label = 'Add to cart';
  if (soldOut) label = 'Sold out';
  else if (atLimit) label = 'Limit reached';
  else if (inCart > 0) label = 'Add another';
  // The quantity is shown as a chip on the photo; screen readers hear it here.
  const inCartNote = inCart > 0 && !soldOut ? <span className="sr-only"> ({inCart} in cart)</span> : null;

  return (
    <m.article className={`card ${soldOut ? 'is-soldout' : ''}`} variants={cardVariants}>
      <div className="card-media">
        <ProductImage sku={p.sku} imageUrl={p.imageUrl} name={p.name} />
        <span className={`stock-pill stock-${stock.tone}`}>{stock.label}</span>
        {inCart > 0 && (
          <span className="incart-chip" aria-hidden="true">
            <ShoppingBag size={12} /> {inCart} in cart
          </span>
        )}
      </div>
      <div className="card-body">
        <span className="sku">{p.sku}</span>
        <h3 className="card-title">{p.name}</h3>
        <p className="card-desc">{p.description}</p>
        <div className="card-footer">
          <span className="price">{formatMoney(p.priceCents)}</span>
          <button
            type="button"
            className={`btn ${inCart > 0 ? 'btn-soft' : 'btn-primary'} btn-add`}
            disabled={soldOut || atLimit}
            onClick={() => onAdd(p)}
          >
            {atLimit && !soldOut ? <Check size={16} aria-hidden="true" /> : null}
            {label}
            {inCartNote}
          </button>
        </div>
      </div>
    </m.article>
  );
}
