import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.jsx';
import { CartProvider } from '../src/cart/CartContext.jsx';
import { getProductImage } from '../src/lib/productImages.js';

const PRODUCTS = [
  { id: 1, sku: 'KB-MECH-01', name: 'Mechanical Keyboard', description: 'Hot-swappable 75% keyboard', priceCents: 459900, stock: 40, imageUrl: null },
  { id: 10, sku: 'CH-65W-10', name: '65 W GaN Charger', description: 'Compact dual-port USB-C charger', priceCents: 259900, stock: 45, imageUrl: null },
  { id: 12, sku: 'LMP-LED-12', name: 'LED Desk Lamp', description: 'Adjustable colour temperature', priceCents: 189900, stock: 0, imageUrl: null },
];

const ORDER = {
  id: '22222222-2222-4222-8222-222222222222',
  status: 'PAID',
  statusReason: null,
  totalCents: 459900,
  customer: { name: 'Asha', email: 'a@example.com' },
  cardLast4: '0002',
  paymentRef: null,
  items: [{ productId: 1, name: 'Mechanical Keyboard', quantity: 1, unitPriceCents: 459900, lineTotalCents: 459900 }],
  createdAt: '2026-10-05T10:00:00.000Z',
};

const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));

function mockApi({ order = ORDER, orderStatus = 200, postOrder } = {}) {
  return vi.fn((url, init = {}) => {
    if (url.startsWith('/api/products')) return json({ items: PRODUCTS, page: 1, limit: 50, total: PRODUCTS.length });
    if (url === '/api/instance') return json({ instanceId: 'i-0abc', availabilityZone: 'ap-southeast-2a', version: 'test' });
    if (url === '/api/cart/quote') {
      const { items } = JSON.parse(init.body);
      const lines = items.map((i) => ({ ...i, name: 'x', unitPriceCents: 459900, lineTotalCents: 459900 * i.quantity, stock: 40, available: true }));
      return json({ items: lines, subtotalCents: lines.reduce((s, l) => s + l.lineTotalCents, 0), warnings: [] });
    }
    if (url === '/api/orders' && init.method === 'POST') return postOrder(init);
    if (url.startsWith('/api/orders/')) return json(order, orderStatus);
    return json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
  });
}

const renderApp = (path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <CartProvider>
        <App />
      </CartProvider>
    </MemoryRouter>,
  );

afterEach(() => vi.unstubAllGlobals());

describe('product images', () => {
  it('maps SKUs to local images and prefers an image URL stored on the product', () => {
    expect(getProductImage({ sku: 'KB-MECH-01' }).src).toBe('/products/kb-mech-01.webp');
    expect(getProductImage({ sku: 'KB-MECH-01', imageUrl: 'https://cdn.example.com/kb.webp' }).src).toBe(
      'https://cdn.example.com/kb.webp',
    );
    expect(getProductImage({ sku: 'UNKNOWN' })).toBeNull();
  });

  it('renders product photos lazily in the catalogue', async () => {
    vi.stubGlobal('fetch', mockApi());
    renderApp();
    const card = (await screen.findByText('Mechanical Keyboard')).closest('article');
    const img = within(card).getByRole('img');
    expect(img).toHaveAttribute('src', '/products/kb-mech-01.webp');
    expect(img).toHaveAttribute('loading', 'lazy');
  });
});

describe('search', () => {
  it('filters products by the ?q= search term and can clear it', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', mockApi());
    renderApp('/?q=charger');

    expect(await screen.findByText('65 W GaN Charger')).toBeInTheDocument();
    expect(screen.queryByText('Mechanical Keyboard')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Search products')).toHaveValue('charger');

    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByText('Mechanical Keyboard')).toBeInTheDocument();
  });

  it('keeps every typed character while filtering live', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', mockApi());
    renderApp();
    await screen.findByText('Mechanical Keyboard');

    await user.type(screen.getByLabelText('Search products'), 'usb-c');
    expect(screen.getByLabelText('Search products')).toHaveValue('usb-c');
    expect(await screen.findByText('1 result for “usb-c”', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText('Mechanical Keyboard')).not.toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    vi.stubGlobal('fetch', mockApi());
    renderApp('/?q=toaster');
    expect(await screen.findByText('No products match')).toBeInTheDocument();
  });
});

describe('checkout feedback', () => {
  it('explains a declined card, keeps the cart, and uses a new idempotency key for the next attempt', async () => {
    const user = userEvent.setup();
    const postOrder = vi.fn(() =>
      json(
        {
          error: { code: 'PAYMENT_DECLINED', message: 'Card declined by issuer (test card)' },
          order: { ...ORDER, status: 'PAYMENT_FAILED' },
        },
        402,
      ),
    );
    vi.stubGlobal('fetch', mockApi({ postOrder }));
    renderApp();

    const card = (await screen.findByText('Mechanical Keyboard')).closest('article');
    await user.click(within(card).getByRole('button', { name: 'Add to cart' }));
    await user.click(screen.getByLabelText('Cart, 1 items'));
    await user.click(await screen.findByRole('button', { name: 'Proceed to checkout' }));

    await user.type(screen.getByLabelText('Full name'), 'Asha');
    await user.type(screen.getByLabelText('Email'), 'a@example.com');
    await user.click(screen.getByRole('button', { name: /4000 0000 0000 0002/ }));
    await user.type(screen.getByLabelText('Expiry (MM/YY)'), '1230');
    await user.type(screen.getByLabelText('CVC'), '123');
    expect(screen.getByLabelText('Card number')).toHaveValue('4000 0000 0000 0002');
    expect(screen.getByLabelText('Expiry (MM/YY)')).toHaveValue('12/30');

    await user.click(screen.getByRole('button', { name: /^Pay/ }));
    expect(await screen.findByText('Payment declined')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View the failed order/ })).toHaveAttribute('href', `/orders/${ORDER.id}`);
    expect(screen.getByLabelText('Cart, 1 items')).toBeInTheDocument(); // cart kept

    await user.click(screen.getByRole('button', { name: /^Pay/ }));
    await screen.findByText('Payment declined');
    const keys = postOrder.mock.calls.map(([init]) => init.headers['Idempotency-Key']);
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('catches obvious form mistakes without calling the API', async () => {
    const user = userEvent.setup();
    const postOrder = vi.fn();
    vi.stubGlobal('fetch', mockApi({ postOrder }));
    renderApp();

    const card = (await screen.findByText('Mechanical Keyboard')).closest('article');
    await user.click(within(card).getByRole('button', { name: 'Add to cart' }));
    await user.click(screen.getByLabelText('Cart, 1 items'));
    await user.click(await screen.findByRole('button', { name: 'Proceed to checkout' }));
    await user.click(screen.getByRole('button', { name: /^Pay/ }));

    expect(screen.getByText('Enter your full name')).toBeInTheDocument();
    expect(screen.getByText('Expiry must be MM/YY')).toBeInTheDocument();
    expect(postOrder).not.toHaveBeenCalled();
  });
});

describe('order page', () => {
  it.each([
    ['PAID', /Payment received/, 'Paid'],
    ['PENDING', /being processed/, 'Processing'],
    ['PAYMENT_FAILED', /No money was taken/, 'Payment failed'],
    ['EXPIRED', /did not complete and was cancelled/, 'Expired'],
  ])('shows the %s state', async (status, message, badge) => {
    vi.stubGlobal('fetch', mockApi({ order: { ...ORDER, status } }));
    renderApp(`/orders/${ORDER.id}`);
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getAllByText(badge).some((el) => el.closest('.status-badge'))).toBe(true);
  });

  it('shows a not-found state for unknown orders', async () => {
    vi.stubGlobal('fetch', mockApi({ order: { error: { code: 'NOT_FOUND', message: 'Order not found' } }, orderStatus: 404 }));
    renderApp(`/orders/${ORDER.id}`);
    expect(await screen.findByRole('heading', { name: 'Order not found' })).toBeInTheDocument();
  });
});
