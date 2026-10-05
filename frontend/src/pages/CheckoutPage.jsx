import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, m } from 'framer-motion';
import { ArrowLeft, ArrowRight, CircleX, CreditCard, Info, Lock, ShoppingBag, TriangleAlert, User } from 'lucide-react';
import { useCart } from '../cart/CartContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ProductImage from '../components/ProductImage.jsx';
import { useCatalogLookup } from '../lib/catalog.js';
import { submitOrder } from '../lib/checkout.js';
import { formatMoney } from '../lib/money.js';
import { uuidv4 } from '../lib/uuid.js';

const EMPTY_FORM = { name: '', email: '', cardNumber: '', expiry: '', cvc: '' };

const TEST_CARDS = [
  { number: '4242 4242 4242 4242', outcome: 'approves' },
  { number: '4000 0000 0000 0002', outcome: 'declines' },
];

// Input formatting only; the server strips spaces and validates everything.
const digits = (s) => s.replace(/\D/g, '');
const FORMATTERS = {
  cardNumber: (v) => digits(v).slice(0, 19).replace(/(\d{4})(?=\d)/g, '$1 '),
  expiry: (v) => {
    const d = digits(v).slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d;
  },
  cvc: (v) => digits(v).slice(0, 4),
};

/** Quick client-side checks so obvious mistakes don't need a round trip. */
function validate(form) {
  const errors = new Map();
  if (!form.name.trim()) errors.set('customer.name', 'Enter your full name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.set('customer.email', 'Enter a valid email address');
  if (!/^\d{12,19}$/.test(digits(form.cardNumber))) errors.set('payment.cardNumber', 'Card number must be 12-19 digits');
  if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(form.expiry)) errors.set('payment.expiry', 'Expiry must be MM/YY');
  if (!/^\d{3,4}$/.test(form.cvc)) errors.set('payment.cvc', 'CVC must be 3 or 4 digits');
  return errors;
}

export default function CheckoutPage() {
  const { items, count, subtotalCents, clear } = useCart();
  const navigate = useNavigate();
  const catalog = useCatalogLookup();
  const [form, setForm] = useState(EMPTY_FORM);
  const [clientErrors, setClientErrors] = useState(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // One key per checkout attempt. It is kept across automatic retries and
  // double-clicks, and replaced only when the request itself must change
  // (declined card, stock problem, invalid input).
  const idempotencyKey = useRef(uuidv4());
  const failures = useRef(0); // keys each error message so a repeat failure re-announces

  if (items.length === 0) {
    return (
      <section className="page">
        <EmptyState
          icon={ShoppingBag}
          title="Nothing to check out"
          action={
            <Link to="/#catalogue" className="btn btn-primary">
              Browse products <ArrowRight size={16} aria-hidden="true" />
            </Link>
          }
        >
          <p>Your cart is empty. Add a product to start a checkout.</p>
        </EmptyState>
      </section>
    );
  }

  const setField = (field, raw) => {
    const value = FORMATTERS[field] ? FORMATTERS[field](raw) : raw;
    setForm((f) => ({ ...f, [field]: value }));
  };
  const update = (field) => (e) => setField(field, e.target.value);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    const problems = validate(form);
    setClientErrors(problems);
    if (problems.size > 0) {
      setError(null);
      const form = e.currentTarget;
      requestAnimationFrame(() => form.querySelector('.has-error input')?.focus());
      return;
    }
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
      failures.current += 1;
      setError(err);
      if (err.status !== 0 && err.status < 500) idempotencyKey.current = uuidv4();
      setSubmitting(false);
    }
  }

  // Validation errors from the API come back as [{ path, message }].
  const serverErrors = Array.isArray(error?.details) ? error.details.map((d) => [d.path, d.message]) : [];
  const fieldErrors = new Map([...clientErrors, ...serverErrors]);

  return (
    <section className="page">
      <Link to="/cart" className="btn-link back-link">
        <ArrowLeft size={16} aria-hidden="true" /> Back to cart
      </Link>
      <div className="page-head">
        <h1 className="page-title">Checkout</h1>
        <span className="secure-note">
          <Lock size={14} aria-hidden="true" /> Retry-safe order submission
        </span>
      </div>

      <div className="checkout-layout">
        <div>
          <AnimatePresence>{error && <CheckoutError key={failures.current} error={error} />}</AnimatePresence>

          <form onSubmit={handleSubmit} noValidate className="checkout-form">
            <fieldset disabled={submitting} className="panel form-section">
              <legend>
                <span className="step">1</span> <User size={16} aria-hidden="true" /> Contact
              </legend>
              <Field label="Full name" name="customer.name" errors={fieldErrors}>
                <input value={form.name} onChange={update('name')} autoComplete="name" placeholder="Asha Verma" required />
              </Field>
              <Field label="Email" name="customer.email" errors={fieldErrors}>
                <input
                  type="email"
                  value={form.email}
                  onChange={update('email')}
                  autoComplete="email"
                  placeholder="asha@example.com"
                  required
                />
              </Field>
            </fieldset>

            <fieldset disabled={submitting} className="panel form-section">
              <legend>
                <span className="step">2</span> <CreditCard size={16} aria-hidden="true" /> Payment
              </legend>
              <div className="mock-banner">
                <Info size={16} aria-hidden="true" />
                <span>
                  <strong>Demo payment.</strong> This store uses a mock payment gateway, so no real charge is made. Use
                  a test card:
                </span>
              </div>
              <div className="test-cards">
                {TEST_CARDS.map((c) => (
                  <button
                    key={c.number}
                    type="button"
                    className={`test-card ${digits(form.cardNumber) === digits(c.number) ? 'is-active' : ''}`}
                    onClick={() => setField('cardNumber', c.number)}
                  >
                    <code>{c.number}</code>
                    <span className={c.outcome === 'approves' ? 'tc-ok' : 'tc-bad'}>{c.outcome}</span>
                  </button>
                ))}
              </div>
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
                  <input
                    value={form.expiry}
                    onChange={update('expiry')}
                    inputMode="numeric"
                    placeholder="12/30"
                    autoComplete="cc-exp"
                    required
                  />
                </Field>
                <Field label="CVC" name="payment.cvc" errors={fieldErrors}>
                  <input
                    value={form.cvc}
                    onChange={update('cvc')}
                    inputMode="numeric"
                    autoComplete="cc-csc"
                    placeholder="123"
                    required
                  />
                </Field>
              </div>
            </fieldset>

            <button type="submit" className="btn btn-accent btn-wide btn-lg pay-btn" disabled={submitting}>
              {submitting ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Placing order…
                </>
              ) : (
                <>
                  <Lock size={16} aria-hidden="true" /> {`Pay ${formatMoney(subtotalCents)}`}
                </>
              )}
            </button>
            <p className="muted small center" role={submitting ? 'status' : undefined}>
              {submitting
                ? 'Processing your payment. If the connection drops we retry automatically with the same idempotency key, so the order is never placed twice.'
                : 'Your order is created once, even if you click twice or the network retries.'}
            </p>
          </form>
        </div>

        <aside className="panel summary-panel" aria-label="Order summary">
          <h2>Order summary</h2>
          <ul className="summary-lines">
            {items.map((i) => {
              const product = catalog.get(i.productId);
              return (
                <li key={i.productId}>
                  <span className="summary-thumb">
                    <ProductImage sku={product?.sku} imageUrl={product?.imageUrl} name={i.name} className="thumb thumb-sm" decorative />
                    <span className="qty-dot">{i.quantity}</span>
                  </span>
                  <span className="summary-name">{i.name}</span>
                  <span>{formatMoney(i.priceCents * i.quantity)}</span>
                </li>
              );
            })}
          </ul>
          <dl className="totals">
            <div>
              <dt>Items</dt>
              <dd>{count}</dd>
            </div>
            <div className="totals-grand">
              <dt>Total</dt>
              <dd>{formatMoney(subtotalCents)}</dd>
            </div>
          </dl>
          <p className="muted small">Final prices are confirmed by the server when you pay.</p>
        </aside>
      </div>
    </section>
  );
}

/** Explains a failed checkout and what the shopper can do next. */
function CheckoutError({ error }) {
  // The Pay button is at the bottom of the form; bring the message into view.
  const ref = useRef(null);
  useEffect(() => ref.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }), []);

  let title = 'Checkout failed';
  let hint = null;
  let link = null;

  switch (error.code) {
    case 'PAYMENT_DECLINED':
      title = 'Payment declined';
      hint = 'No money was taken. Check the card details or try a different card.';
      if (error.body?.order?.id) link = { to: `/orders/${error.body.order.id}`, label: 'View the failed order' };
      break;
    case 'OUT_OF_STOCK':
      title = 'An item just sold out';
      hint = 'Update the quantities in your cart and try again.';
      link = { to: '/cart', label: 'Review cart' };
      break;
    case 'VALIDATION_ERROR':
      title = 'Please check your details';
      hint = 'Some fields need attention. They are highlighted below.';
      break;
    case 'CHECKOUT_EXPIRED':
      title = 'Checkout timed out';
      if (error.details?.orderId) link = { to: `/orders/${error.details.orderId}`, label: 'View the expired order' };
      break;
    default:
      if (error.status === 0 || error.status >= 500) {
        title = 'We could not reach the store';
        hint = 'We retried automatically. Your order was not duplicated, so it is safe to try again.';
      }
  }

  const Icon = error.code === 'PAYMENT_DECLINED' ? CircleX : TriangleAlert;
  return (
    <m.div
      ref={ref}
      className="alert alert-strong"
      role="alert"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0, x: [0, -6, 6, -3, 0] }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
    >
      <Icon size={20} className="alert-icon" aria-hidden="true" />
      <div className="alert-body">
        <strong>{title}</strong>
        <span>{error.message}</span>
        {hint && <span className="muted">{hint}</span>}
        {link && (
          <Link to={link.to} className="btn-link">
            {link.label} <ArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
      </div>
    </m.div>
  );
}

function Field({ label, name, errors, children }) {
  const message = errors.get(name);
  return (
    <label className={`field ${message ? 'has-error' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {message && <span className="field-error">{message}</span>}
    </label>
  );
}
