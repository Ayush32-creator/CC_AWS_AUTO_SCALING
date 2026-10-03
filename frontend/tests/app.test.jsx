import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App.jsx';
import { CartProvider } from '../src/cart/CartContext.jsx';

const PRODUCTS = [
  { id: 1, sku: 'KB', name: 'Mechanical Keyboard', description: 'Clicky', priceCents: 459900, stock: 40, imageUrl: null },
  { id: 12, sku: 'LMP', name: 'LED Desk Lamp', description: 'Bright', priceCents: 189900, stock: 0, imageUrl: null },
];

function json(body, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

function mockApi() {
  return vi.fn((url, init = {}) => {
    if (url.startsWith('/api/products')) return json({ items: PRODUCTS, page: 1, limit: 50, total: 2 });
    if (url === '/api/instance') return json({ instanceId: 'i-0abc', availabilityZone: 'ap-south-1a', version: 'test' });
    if (url === '/api/cart/quote') {
      const { items } = JSON.parse(init.body);
      const lines = items.map((i) => ({
        ...i,
        name: 'Mechanical Keyboard',
        unitPriceCents: 459900,
        lineTotalCents: 459900 * i.quantity,
        stock: 40,
        available: true,
      }));
      return json({ items: lines, subtotalCents: lines.reduce((s, l) => s + l.lineTotalCents, 0), warnings: [] });
    }
    if (url === '/api/orders' && init.method === 'POST') {
      return json(
        {
          id: '11111111-1111-4111-8111-111111111111',
          status: 'PAID',
          totalCents: 459900,
          customer: { name: 'Asha', email: 'a@example.com' },
          cardLast4: '4242',
          paymentRef: 'mock_1',
          items: [{ productId: 1, name: 'Mechanical Keyboard', quantity: 1, unitPriceCents: 459900, lineTotalCents: 459900 }],
          createdAt: new Date().toISOString(),
        },
        201,
      );
    }
    if (url.startsWith('/api/orders/')) {
      return json({
        id: '11111111-1111-4111-8111-111111111111',
        status: 'PAID',
        totalCents: 459900,
        customer: { name: 'Asha', email: 'a@example.com' },
        cardLast4: '4242',
        paymentRef: 'mock_1',
        items: [{ productId: 1, name: 'Mechanical Keyboard', quantity: 1, unitPriceCents: 459900, lineTotalCents: 459900 }],
        createdAt: new Date().toISOString(),
      });
    }
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

describe('App', () => {
  let fetchMock;
  beforeEach(() => {
    fetchMock = mockApi();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('lists products, disables out-of-stock items, and shows the serving instance', async () => {
    renderApp();
    expect(await screen.findByText('Mechanical Keyboard')).toBeInTheDocument();
    const lampCard = screen.getByText('LED Desk Lamp').closest('article');
    expect(within(lampCard).getByRole('button')).toBeDisabled();
    expect(await screen.findByText('i-0abc')).toBeInTheDocument();
  });

  it('adds to cart and completes checkout end-to-end', async () => {
    const user = userEvent.setup();
    renderApp();

    const keyboardCard = (await screen.findByText('Mechanical Keyboard')).closest('article');
    await user.click(within(keyboardCard).getByRole('button', { name: 'Add to cart' }));
    expect(screen.getByLabelText('Cart, 1 items')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Cart, 1 items'));
    await user.click(await screen.findByRole('button', { name: 'Proceed to checkout' }));

    await user.type(screen.getByLabelText('Full name'), 'Asha');
    await user.type(screen.getByLabelText('Email'), 'a@example.com');
    await user.type(screen.getByLabelText('Card number'), '4242424242424242');
    await user.type(screen.getByLabelText('Expiry (MM/YY)'), '12/30');
    await user.type(screen.getByLabelText('CVC'), '123');
    await user.click(screen.getByRole('button', { name: /^Pay/ }));

    expect(await screen.findByText(/Payment received/)).toBeInTheDocument();
    const orderCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/orders' && init?.method === 'POST');
    expect(orderCall[1].headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByLabelText('Cart, 0 items')).toBeInTheDocument(); // cart cleared
  });
});
