import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { m } from 'framer-motion';
import { ArrowRight, PackageX, RefreshCw, ShoppingBag } from 'lucide-react';
import EmptyState from '../components/EmptyState.jsx';
import ProductImage from '../components/ProductImage.jsx';
import { PanelSkeleton } from '../components/Skeleton.jsx';
import StatusBadge, { ORDER_STATUS } from '../components/StatusBadge.jsx';
import { ErrorMessage } from '../components/Status.jsx';
import { api } from '../lib/api.js';
import { useCatalogLookup } from '../lib/catalog.js';
import { formatMoney } from '../lib/money.js';

const STATUS_COPY = {
  PAID: { title: 'Order confirmed', text: 'Payment received — thank you for your order!' },
  PENDING: { title: 'Processing payment', text: 'Your payment is being processed…' },
  PAYMENT_FAILED: { title: 'Payment failed', text: 'Payment failed. No money was taken.' },
  // Set by the server's pending-order reaper when a checkout never finished.
  EXPIRED: {
    title: 'Checkout expired',
    text: 'This checkout did not complete and was cancelled. The items were released — please order again.',
  },
};

export default function OrderPage() {
  const { id } = useParams();
  const catalog = useCatalogLookup();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setError(null);
    setRefreshing(true);
    api
      .getOrder(id)
      .then(setOrder)
      .catch(setError)
      .finally(() => setRefreshing(false));
  }, [id]);

  useEffect(load, [load]);

  if (error) {
    if (error.status === 404 || error.code === 'VALIDATION_ERROR') {
      return (
        <section className="page">
          <EmptyState
            icon={PackageX}
            title="Order not found"
            action={
              <Link to="/" className="btn btn-primary">
                Back to the store
              </Link>
            }
          >
            <p>We couldn't find an order with this ID. Check the link and try again.</p>
          </EmptyState>
        </section>
      );
    }
    return (
      <section className="page">
        <ErrorMessage error={error} onRetry={load} title="We couldn't load this order." />
      </section>
    );
  }
  if (!order) {
    return (
      <section className="page">
        <PanelSkeleton label="Loading order…" />
      </section>
    );
  }

  const meta = ORDER_STATUS[order.status] ?? ORDER_STATUS.PENDING;
  const copy = STATUS_COPY[order.status] ?? { title: order.status, text: '' };
  const Icon = meta.icon;

  return (
    <section className="page order">
      <m.div
        className={`order-hero tone-${meta.tone}`}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
      >
        <m.span
          className="order-icon"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 320, damping: 18, delay: 0.1 }}
        >
          <Icon size={34} aria-hidden="true" className={order.status === 'PENDING' ? 'pulse' : undefined} />
        </m.span>
        <div>
          <StatusBadge status={order.status} />
          <h1 className="page-title">{copy.title}</h1>
          <p className="order-message">{copy.text}</p>
          {order.statusReason && <p className="muted small">Reason: {order.statusReason}</p>}
        </div>
      </m.div>

      <div className="order-layout">
        <div className="panel">
          <h2>Items</h2>
          <ul className="summary-lines">
            {order.items.map((i) => {
              const product = catalog.get(i.productId);
              return (
                <li key={i.productId}>
                  <span className="summary-thumb">
                    <ProductImage sku={product?.sku} imageUrl={product?.imageUrl} name={i.name} className="thumb thumb-sm" decorative />
                    <span className="qty-dot">{i.quantity}</span>
                  </span>
                  <span className="summary-name">
                    {i.name}
                    <span className="muted small">{formatMoney(i.unitPriceCents ?? i.lineTotalCents / i.quantity)} each</span>
                  </span>
                  <span>{formatMoney(i.lineTotalCents)}</span>
                </li>
              );
            })}
          </ul>
          <dl className="totals">
            <div className="totals-grand">
              <dt>Total</dt>
              <dd>{formatMoney(order.totalCents)}</dd>
            </div>
          </dl>
        </div>

        <div className="panel">
          <h2>Details</h2>
          <dl className="meta">
            <dt>Order ID</dt>
            <dd>
              <code>{order.id}</code>
            </dd>
            <dt>Customer</dt>
            <dd>
              {order.customer.name}
              <span className="muted small">{order.customer.email}</span>
            </dd>
            <dt>Card</dt>
            <dd>•••• {order.cardLast4}</dd>
            {order.paymentRef && (
              <>
                <dt>Payment ref</dt>
                <dd>
                  <code>{order.paymentRef}</code>
                </dd>
              </>
            )}
            <dt>Placed</dt>
            <dd>{new Date(order.createdAt).toLocaleString()}</dd>
          </dl>
        </div>
      </div>

      <div className="order-actions">
        {order.status === 'PENDING' && (
          <button type="button" className="btn btn-soft" onClick={load} disabled={refreshing}>
            <RefreshCw size={16} className={refreshing ? 'spin' : undefined} aria-hidden="true" /> Check status again
          </button>
        )}
        {(order.status === 'PAYMENT_FAILED' || order.status === 'EXPIRED') && (
          <Link to="/cart" className="btn btn-soft">
            <ShoppingBag size={16} aria-hidden="true" /> Return to cart
          </Link>
        )}
        <Link to="/" className="btn btn-primary">
          Continue shopping <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
