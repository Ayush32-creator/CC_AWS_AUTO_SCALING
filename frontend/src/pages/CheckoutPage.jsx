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

  // One key per checkout attempt. It is kept across automatic retries and
  // double-clicks, and replaced only when the request itself must change
  // (declined card, stock problem, invalid input).
  const idempotencyKey = useRef(uuidv4());

  if (items.length === 0) {
    return (
      <p className="notice">
        Nothing to check out. <Link to="/">Browse products</Link>
      </p>
    );
  }

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
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

  // Validation errors from the API come back as [{ path, message }].
  const fieldErrors = new Map(Array.isArray(error?.details) ? error.details.map((d) => [d.path, d.message]) : []);

  return (
    <section className="checkout">
      <div>
        <h1>Checkout</h1>
        <ErrorMessage error={error} />
        <form onSubmit={handleSubmit} noValidate>
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

          <button type="submit" className="btn btn-wide" disabled={submitting}>
            {submitting ? 'Placing order…' : `Pay ${formatMoney(subtotalCents)}`}
          </button>
        </form>
      </div>

      <aside className="panel">
        <h2>Order summary</h2>
        <ul className="lines">
          {items.map((i) => (
            <li key={i.productId}>
              <span>
                {i.quantity} × {i.name}
              </span>
              <span>{formatMoney(i.priceCents * i.quantity)}</span>
            </li>
          ))}
        </ul>
        <p className="lines-total">
          <span>Total</span>
          <strong>{formatMoney(subtotalCents)}</strong>
        </p>
        <p className="muted small">Final prices are confirmed by the server when you pay.</p>
      </aside>
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
