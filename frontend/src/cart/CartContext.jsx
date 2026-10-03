import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import { cartCount, cartReducer, cartSubtotal } from './cartReducer.js';

const STORAGE_KEY = 'cc-checkout-cart';
const CartContext = createContext(null);

function loadCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function CartProvider({ children }) {
  const [items, dispatch] = useReducer(cartReducer, undefined, loadCart);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* storage unavailable (private mode) — cart still works in memory */
    }
  }, [items]);

  const value = useMemo(
    () => ({
      items,
      count: cartCount(items),
      subtotalCents: cartSubtotal(items),
      add: (product) => dispatch({ type: 'add', product }),
      setQuantity: (productId, quantity) => dispatch({ type: 'setQuantity', productId, quantity }),
      remove: (productId) => dispatch({ type: 'remove', productId }),
      clear: () => dispatch({ type: 'clear' }),
    }),
    [items],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
