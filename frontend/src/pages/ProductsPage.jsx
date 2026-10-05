import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCart } from '../cart/CartContext.jsx';
import { MAX_QUANTITY } from '../cart/cartReducer.js';
import ProductImage from '../components/ProductImage.jsx';
import { ErrorMessage, Loading } from '../components/Status.jsx';
import { api } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';

const categoryMap = [
  { label: 'Workspace', query: 'keyboard', matcher: /keyboard|mouse|monitor|hub|charger|stand|lamp|desk/i },
  { label: 'Audio', query: 'headphone', matcher: /headphone|speaker/i },
  { label: 'Workflows', query: 'webcam', matcher: /webcam|ssd|mat|hub/i },
  { label: 'Power', query: 'charger', matcher: /charger|lamp/i },
];

export default function ProductsPage({ searchQuery = '', setSearchQuery }) {
  const { items: cartItems, add } = useCart();
  const [products, setProducts] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setError(null);
    api
      .listProducts()
      .then((data) => setProducts(data.items))
      .catch(setError);
  }, []);

  useEffect(load, [load]);

  const filteredProducts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return products ?? [];
    return (products ?? []).filter((product) => {
      const haystack = `${product.name} ${product.description ?? ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [products, searchQuery]);

  const featuredProducts = products ? products.filter((product) => ![products[0]?.id, products[1]?.id].includes(product.id)).slice(0, 2) : [];

  if (error) return <ErrorMessage error={error} onRetry={load} />;

  if (!products) {
    return (
      <section className="catalog-page">
        <div className="hero hero--loading" aria-live="polite">
          <div className="hero-copy">
            <div className="skeleton skeleton-line skeleton-line--lg" />
            <div className="skeleton skeleton-line skeleton-line--md" />
            <div className="skeleton skeleton-line skeleton-line--sm" />
          </div>
          <div className="hero-visual hero-visual--loading">
            <div className="skeleton skeleton-card" />
            <div className="skeleton skeleton-card" />
          </div>
        </div>
        <div className="catalog-grid catalog-grid--skeleton">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="skeleton product-card-skeleton" key={index} />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="catalog-page">
      <div className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Curated for the way you build</p>
          <h1>Shop smarter. Live better.</h1>
          <p className="hero-text">Premium workspace essentials, audio, and power tools designed for focused work and a polished routine.</p>
          <div className="hero-actions">
            <a href="#catalog" className="btn btn-primary">
              Explore products
            </a>
            <button type="button" className="btn btn-secondary" onClick={() => setSearchQuery && setSearchQuery('')}>
              Browse all
            </button>
          </div>
          <div className="hero-stats">
            <div>
              <strong>12</strong>
              <span>Curated picks</span>
            </div>
            <div>
              <strong>24h</strong>
              <span>Fast dispatch</span>
            </div>
            <div>
              <strong>4.9/5</strong>
              <span>Customer love</span>
            </div>
          </div>
        </div>

        <div className="hero-visual" aria-label="Featured products showcase">
          <div className="showcase-card showcase-card--large">
            <ProductImage product={products[0]} priority />
          </div>
          <div className="showcase-card showcase-card--top">
            <ProductImage product={products[2]} priority />
          </div>
          <div className="showcase-card showcase-card--bottom">
            <ProductImage product={products[6]} priority />
          </div>
        </div>
      </div>

      <div className="category-row" aria-label="Browse by category">
        {categoryMap.map(({ label, query, matcher }) => {
          const count = products.filter((product) => matcher.test(product.name)).length;
          return (
            <button type="button" key={label} className="category-pill" onClick={() => setSearchQuery && setSearchQuery(query)}>
              {label}
              <span>{count}</span>
            </button>
          );
        })}
      </div>

      <div className="section-heading">
        <div>
          <p className="eyebrow">Trending now</p>
          <h2>Featured essentials</h2>
        </div>
      </div>

      <div className="featured-grid">
        {featuredProducts.map((product) => {
          const inCart = cartItems.find((item) => item.productId === product.id)?.quantity ?? 0;
          const atLimit = inCart >= Math.min(product.stock, MAX_QUANTITY);
          return (
            <article key={product.id} className="feature-card">
              <div className="feature-card__media">
                <ProductImage product={product} priority />
              </div>
              <div className="feature-card__body">
                <p className="eyebrow eyebrow--compact">{categoryMap.find(({ matcher }) => matcher.test(product.name))?.label ?? 'Featured'}</p>
                <h3>{product.name}</h3>
                <p>{product.description}</p>
                <div className="feature-card__footer">
                  <strong>{formatMoney(product.priceCents)}</strong>
                  <button
                    type="button"
                    className="btn btn-primary btn-compact"
                    disabled={product.stock === 0 || atLimit}
                    onClick={() => add(product)}
                  >
                    {inCart > 0 ? 'Add another' : 'Add to cart'}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div id="catalog" className="catalog-header">
        <div>
          <p className="eyebrow">NEXORA catalog</p>
          <h2>{searchQuery ? `Results for “${searchQuery}”` : 'Explore the collection'}</h2>
        </div>
        {searchQuery && (
          <button type="button" className="text-btn" onClick={() => setSearchQuery && setSearchQuery('')}>
            Clear search
          </button>
        )}
      </div>

      {filteredProducts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state__icon">⌕</div>
          <h3>No products match your search.</h3>
          <p>Try a different keyword or clear the filter to explore the full catalog.</p>
          <button type="button" className="btn btn-primary" onClick={() => setSearchQuery && setSearchQuery('')}>
            Clear search
          </button>
        </div>
      ) : (
        <div className="product-grid">
          {filteredProducts.map((product) => {
            const inCart = cartItems.find((item) => item.productId === product.id)?.quantity ?? 0;
            const atLimit = inCart >= Math.min(product.stock, MAX_QUANTITY);
            return (
              <article key={product.id} className="product-card">
                <div className="product-card__media">
                  <ProductImage product={product} />
                </div>
                <div className="product-card__body">
                  <span className="pill">
                    {categoryMap.find(({ matcher }) => matcher.test(product.name))?.label ?? 'Collection'}
                  </span>
                  <h3>{product.name}</h3>
                  <p className="muted">{product.description}</p>
                  <div className="product-card__meta">
                    <strong>{formatMoney(product.priceCents)}</strong>
                    <span className={product.stock === 0 ? 'stock stock--out' : product.stock <= 5 ? 'stock stock--low' : 'stock'}>
                      {product.stock === 0 ? 'Out of stock' : product.stock <= 5 ? `Only ${product.stock} left` : 'In stock'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={product.stock === 0 || atLimit}
                    onClick={() => add(product)}
                  >
                    {inCart > 0 ? `Add another (${inCart} in cart)` : 'Add to cart'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="promo-block">
        <div>
          <p className="eyebrow">Upgrade the everyday</p>
          <h3>Designed for quieter focus, cleaner desks, and better flow.</h3>
        </div>
        <a href="#catalog" className="btn btn-secondary">
          Explore collection
        </a>
      </div>

      <div className="trust-band">
        <div>
          <strong>Fast setup</strong>
          <span>Ready in minutes</span>
        </div>
        <div>
          <strong>Built for work</strong>
          <span>Efficient by default</span>
        </div>
        <div>
          <strong>Support that cares</strong>
          <span>Helpful and human</span>
        </div>
      </div>
    </section>
  );
}

