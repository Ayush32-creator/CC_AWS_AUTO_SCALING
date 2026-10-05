import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { m } from 'framer-motion';
import { Gauge, PackageCheck, RefreshCw, SearchX } from 'lucide-react';
import { useCart } from '../cart/CartContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Hero from '../components/Hero.jsx';
import ProductCard from '../components/ProductCard.jsx';
import { ProductGridSkeleton } from '../components/Skeleton.jsx';
import { ErrorMessage } from '../components/Status.jsx';
import { useToast } from '../components/Toast.jsx';
import { fetchCatalog } from '../lib/catalog.js';

const SORTS = {
  featured: { label: 'Featured', compare: (a, b) => a.id - b.id },
  'price-asc': { label: 'Price: low to high', compare: (a, b) => a.priceCents - b.priceCents },
  'price-desc': { label: 'Price: high to low', compare: (a, b) => b.priceCents - a.priceCents },
  name: { label: 'Name: A–Z', compare: (a, b) => a.name.localeCompare(b.name) },
};

const FEATURES = [
  { icon: PackageCheck, title: 'Server-confirmed prices', text: 'Your cart is re-priced and stock-checked by the API before you pay.' },
  { icon: RefreshCw, title: 'Retry-safe checkout', text: 'Double-clicks, timeouts and retries can never create a second order.' },
  { icon: Gauge, title: 'Built to scale', text: 'Served by an EC2 Auto Scaling group that grows with traffic.' },
];

export const matchesQuery = (p, q) =>
  !q || [p.name, p.description, p.sku].some((field) => field?.toLowerCase().includes(q));

export default function ProductsPage() {
  const { items: cartItems, add } = useCart();
  const { notify } = useToast();
  const [params, setParams] = useSearchParams();
  const [products, setProducts] = useState(null);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState('featured');
  const [inStockOnly, setInStockOnly] = useState(false);

  const query = (params.get('q') ?? '').trim().toLowerCase();

  const load = useCallback(() => {
    setError(null);
    fetchCatalog({ fresh: true }).then(setProducts).catch(setError);
  }, []);

  useEffect(load, [load]);

  const visible = useMemo(
    () =>
      (products ?? [])
        .filter((p) => matchesQuery(p, query) && (!inStockOnly || p.stock > 0))
        .sort(SORTS[sort].compare),
    [products, query, inStockOnly, sort],
  );

  const handleAdd = (p) => {
    add(p);
    notify({ message: `${p.name} added to your cart`, link: { to: '/cart', label: 'View cart' } });
  };

  const clearFilters = () => {
    setParams({}, { replace: true });
    setInStockOnly(false);
  };

  let content;
  if (error) content = <ErrorMessage error={error} onRetry={load} title="We couldn't load the collection." />;
  else if (!products) content = <ProductGridSkeleton />;
  else if (visible.length === 0)
    content = (
      <EmptyState
        icon={SearchX}
        title="No products match"
        action={
          <button type="button" className="btn btn-soft" onClick={clearFilters}>
            Clear filters
          </button>
        }
      >
        {query ? (
          <p>
            Nothing found for “{params.get('q')}”. Try another word, like “keyboard” or “charger”.
          </p>
        ) : (
          <p>Every product is currently out of stock.</p>
        )}
      </EmptyState>
    );
  else
    content = (
      <m.div className="grid" initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.05 } } }}>
        {visible.map((p) => (
          <ProductCard
            key={p.id}
            product={p}
            inCart={cartItems.find((i) => i.productId === p.id)?.quantity ?? 0}
            onAdd={handleAdd}
          />
        ))}
      </m.div>
    );

  return (
    <>
      <Hero productCount={products?.length} />

      <section id="why" className="features" aria-label="Why NEXORA">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <div key={title} className="feature">
            <span className="feature-icon">
              <Icon size={20} aria-hidden="true" />
            </span>
            <div>
              <h2>{title}</h2>
              <p>{text}</p>
            </div>
          </div>
        ))}
      </section>

      <section id="catalogue" className="catalogue" aria-labelledby="catalogue-title">
        <div className="section-head">
          <div>
            <span className="eyebrow">Catalogue</span>
            <h2 id="catalogue-title" className="section-title">
              The collection
            </h2>
            {products && (
              <p className="muted" aria-live="polite">
                {query ? (
                  <>
                    {visible.length} {visible.length === 1 ? 'result' : 'results'} for “{params.get('q')}”{' '}
                    <button type="button" className="btn-link" onClick={() => setParams({}, { replace: true })}>
                      Show all products
                    </button>
                  </>
                ) : (
                  `${visible.length} of ${products.length} products`
                )}
              </p>
            )}
          </div>

          <div className="toolbar">
            <label className="toggle">
              <input type="checkbox" checked={inStockOnly} onChange={(e) => setInStockOnly(e.target.checked)} />
              <span className="toggle-track" aria-hidden="true" />
              In stock only
            </label>
            <label className="select">
              <span className="sr-only">Sort products</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                {Object.entries(SORTS).map(([key, s]) => (
                  <option key={key} value={key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {content}
      </section>
    </>
  );
}
