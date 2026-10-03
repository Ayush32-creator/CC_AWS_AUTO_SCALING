import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorMessage, Loading } from '../components/Status.jsx';
import { api } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';

const STATUS_TEXT = {
  PAID: 'Payment received — thank you for your order!',
  PENDING: 'Your payment is being processed…',
  PAYMENT_FAILED: 'Payment failed. No money was taken.',
};

export default function OrderPage() {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api.getOrder(id).then(setOrder).catch(setError);
  }, [id]);

  useEffect(load, [load]);

  if (error) return <ErrorMessage error={error} onRetry={error.status === 404 ? undefined : load} />;
  if (!order) return <Loading label="Loading order…" />;

  return (
    <section className="order">
      <h1>Order confirmation</h1>
      <p className={`status status-${order.status.toLowerCase()}`}>{STATUS_TEXT[order.status]}</p>

      <dl className="meta">
        <dt>Order ID</dt>
        <dd>
          <code>{order.id}</code>
        </dd>
        <dt>Customer</dt>
        <dd>
          {order.customer.name} ({order.customer.email})
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

      <ul className="lines panel">
        {order.items.map((i) => (
          <li key={i.productId}>
            <span>
              {i.quantity} × {i.name}
            </span>
            <span>{formatMoney(i.lineTotalCents)}</span>
          </li>
        ))}
        <li className="lines-total">
          <span>Total</span>
          <strong>{formatMoney(order.totalCents)}</strong>
        </li>
      </ul>

      <Link to="/" className="btn">
        Continue shopping
      </Link>
    </section>
  );
}
