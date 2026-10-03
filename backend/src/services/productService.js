import { AppError, notFound } from '../lib/errors.js';

const toProduct = (row) => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  description: row.description,
  priceCents: row.price_cents,
  stock: row.stock,
  imageUrl: row.image_url,
});

export function createProductService({ pool }) {
  return {
    async list({ page, limit }) {
      const offset = (page - 1) * limit;
      const [items, count] = await Promise.all([
        pool.query('SELECT * FROM products ORDER BY id LIMIT $1 OFFSET $2', [limit, offset]),
        pool.query('SELECT count(*) AS total FROM products'),
      ]);
      return { items: items.rows.map(toProduct), page, limit, total: count.rows[0].total };
    },

    async get(id) {
      const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [id]);
      if (rows.length === 0) throw notFound(`Product ${id}`);
      return toProduct(rows[0]);
    },

    /**
     * Price a cart using current DB prices. Read-only: it does not reserve
     * stock, it only warns when the requested quantity is not available.
     */
    async quote(items) {
      const ids = items.map((i) => i.productId);
      const { rows } = await pool.query('SELECT * FROM products WHERE id = ANY($1::int[])', [ids]);
      const byId = new Map(rows.map((r) => [r.id, r]));

      const missing = ids.filter((id) => !byId.has(id));
      if (missing.length > 0) {
        throw new AppError(404, 'NOT_FOUND', `Product(s) not found: ${missing.join(', ')}`, { missing });
      }

      const warnings = [];
      const lines = items.map(({ productId, quantity }) => {
        const p = byId.get(productId);
        const available = p.stock >= quantity;
        if (!available) warnings.push(`Only ${p.stock} left of '${p.name}'`);
        return {
          productId,
          name: p.name,
          quantity,
          unitPriceCents: p.price_cents,
          lineTotalCents: p.price_cents * quantity,
          stock: p.stock,
          available,
        };
      });

      return {
        items: lines,
        subtotalCents: lines.reduce((sum, l) => sum + l.lineTotalCents, 0),
        warnings,
      };
    },
  };
}
