import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../cart/CartContext.jsx';
import { ErrorMessage } from '../components/Status.jsx';
import { submitOrder } from '../lib/checkout.js';
import { formatMoney } from '../lib/money.js';
import { uuidv4 } from '../lib/uuid.js';

const EMPTY_FORM = { name: '', email: '', cardNumber: '', expiry: '', cvc: '' };

export default function CheckoutPage() {
  const { items, subtotalCents, clear } = useCart();
  const navigate = useNavigate();
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const idempotencyKey = useRef(uuidv4());

  if (items.length === 0) {
    return (
      <section className="cart-page">
        <div className="empty-state empty-state--wide">
          <div className="empty-state__icon">✓</div>
          <h1>Checkout</h1>
          <p>Nothing to check out yet. Browse products and add a few essentials to your cart.</p>
          <Link to="/" className="btn btn-primary">
            Browse products
          </Link>
        </div>
      </section>
    );
  }

  const update = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const order = await submitOrder(
        {
          customer: { name: form.name, email: form.email },
          items: items.map(({ productId, quantity }) => ({ productId, quantity })),
          payment: { cardNumber: form.cardNumber, expiry: form.expiry, cvc: form.cvc },
        },
        idempotencyKey.current,
      );
      clear();
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (err) {
      setError(err);
      if (err.status !== 0 && err.status < 500) idempotencyKey.current = uuidv4();
      setSubmitting(false);
    }
  }

  const fieldErrors = new Map(Array.isArray(error?.details) ? error.details.map((detail) => [detail.path, detail.message]) : []);

  return (
    <section className="checkout-page">
      <div className="checkout-layout">
        <div className="checkout-main">
          <p className="eyebrow">Secure checkout</p>
          <h1>Checkout</h1>
          <ErrorMessage error={error} />

          <form className="checkout-form" onSubmit={handleSubmit} noValidate>
            <fieldset disabled={submitting}>
              <legend>Contact</legend>
              <Field label="Full name" name="customer.name" errors={fieldErrors}>
                <input value={form.name} onChange={update('name')} autoComplete="name" required />
              </Field>
              <Field label="Email" name="customer.email" errors={fieldErrors}>
                <input type="email" value={form.email} onChange={update('email')} autoComplete="email" required />
              </Field>
            </fieldset>

            <fieldset disabled={submitting}>
              <legend>Payment (mock — no real charge)</legend>
              <Field label="Card number" name="payment.cardNumber" errors={fieldErrors}>
                <input
                  value={form.cardNumber}
                  onChange={update('cardNumber')}
                  inputMode="numeric"
                  autoComplete="cc-number"
                  placeholder="4242 4242 4242 4242"
                  required
                />
              </Field>
              <div className="row">
                <Field label="Expiry (MM/YY)" name="payment.expiry" errors={fieldErrors}>
                  <input value={form.expiry} onChange={update('expiry')} placeholder="12/30" autoComplete="cc-exp" required />
                </Field>
                <Field label="CVC" name="payment.cvc" errors={fieldErrors}>
                  <input value={form.cvc} onChange={update('cvc')} inputMode="numeric" autoComplete="cc-csc" required />
                </Field>
              </div>
              <p className="muted small">
                Test cards: <code>4242 4242 4242 4242</code> approves · <code>4000 0000 0000 0002</code> declines.
              </p>
            </fieldset>

            <button type="submit" className="btn btn-primary btn-wide" disabled={submitting}>
              {submitting ? 'Processing your order…' : `Pay ${formatMoney(subtotalCents)}`}
            </button>
          </form>
        </div>

        <aside className="panel summary-panel">
          <p className="eyebrow eyebrow--compact">Order summary</p>
          <ul className="lines">
            {items.map((item) => (
              <li key={item.productId}>
                <span>
                  {item.quantity} × {item.name}
                </span>
                <span>{formatMoney(item.priceCents * item.quantity)}</span>
              </li>
            ))}
          </ul>
          <p className="lines-total">
            <span>Total</span>
            <strong>{formatMoney(subtotalCents)}</strong>
          </p>
          <p className="muted small">Final prices are confirmed by the server at payment time.</p>
        </aside>
      </div>
    </section>
  );
}

function Field({ label, name, errors, children }) {
  const message = errors.get(name);
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {message && <span className="field-error">{message}</span>}
    </label>
  );
}
