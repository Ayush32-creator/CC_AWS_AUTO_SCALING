// Pure cart state logic. The cart lives in the browser (localStorage) so the
// app servers stay stateless; prices here are for display only and the
// server re-prices everything at quote/checkout time.

export const MAX_QUANTITY = 10;

const clampQty = (qty, stock) => Math.max(0, Math.min(qty, MAX_QUANTITY, stock ?? MAX_QUANTITY));

export function cartReducer(state, action) {
  switch (action.type) {
    case 'add': {
      const { product } = action;
      const existing = state.find((i) => i.productId === product.id);
      if (existing) {
        return state.map((i) =>
          i.productId === product.id ? { ...i, quantity: clampQty(i.quantity + 1, product.stock), stock: product.stock } : i,
        );
      }
      if (product.stock < 1) return state;
      return [
        ...state,
        { productId: product.id, name: product.name, priceCents: product.priceCents, stock: product.stock, quantity: 1 },
      ];
    }
    case 'setQuantity': {
      return state
        .map((i) => (i.productId === action.productId ? { ...i, quantity: clampQty(action.quantity, i.stock) } : i))
        .filter((i) => i.quantity > 0);
    }
    case 'remove':
      return state.filter((i) => i.productId !== action.productId);
    case 'clear':
      return [];
    default:
      throw new Error(`Unknown cart action: ${action.type}`);
  }
}

export const cartCount = (items) => items.reduce((n, i) => n + i.quantity, 0);
export const cartSubtotal = (items) => items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
