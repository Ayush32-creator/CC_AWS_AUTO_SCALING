// Thin fetch wrapper around the checkout API. All errors are normalised into
// ApiError so pages can switch on `status` / `code`.

export class ApiError extends Error {
  constructor(status, code, message, { details, body } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status; // 0 = network failure (request may or may not have arrived)
    this.code = code;
    this.details = details;
    this.body = body;
  }
}

export async function apiRequest(path, { method = 'GET', body, headers = {}, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(path, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check your connection.');
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error;
    throw new ApiError(res.status, err?.code ?? 'HTTP_ERROR', err?.message ?? `Request failed (${res.status})`, {
      details: err?.details,
      body: data,
    });
  }
  return data;
}

export const api = {
  listProducts: () => apiRequest('/api/products?limit=50'),
  getOrder: (id) => apiRequest(`/api/orders/${encodeURIComponent(id)}`),
  quoteCart: (items) => apiRequest('/api/cart/quote', { method: 'POST', body: { items } }),
  instance: () => apiRequest('/api/instance'),
};
