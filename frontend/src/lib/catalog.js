// Shared product-list cache. The products page always fetches fresh data (stock
// changes); the cart, checkout and order pages only need each product's SKU
// and image, so they reuse the last list instead of re-fetching it.

import { useEffect, useState } from 'react';
import { api } from './api.js';

let cached = null; // Promise<Product[]>

export function fetchCatalog({ fresh = false } = {}) {
  if (!cached || fresh) {
    const request = api.listProducts().then((data) => data.items);
    cached = request;
    request.catch(() => {
      if (cached === request) cached = null; // let the next caller retry
    });
  }
  return cached;
}

/** Map of productId -> product, empty until loaded (and on failure). */
export function useCatalogLookup() {
  const [byId, setById] = useState(() => new Map());
  useEffect(() => {
    let cancelled = false;
    fetchCatalog()
      .then((items) => !cancelled && setById(new Map(items.map((p) => [p.id, p]))))
      .catch(() => {}); // images fall back to a placeholder tile
    return () => {
      cancelled = true;
    };
  }, []);
  return byId;
}
