import { m } from 'framer-motion';
import { ArrowRight, ShieldCheck, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import ProductImage from './ProductImage.jsx';

// Decorative collage; the products themselves are listed in the catalogue.
const COLLAGE = ['HP-ANC-03', 'KB-MECH-01', 'SPK-BT-11'];

const rise = (delay) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] },
});

export default function Hero({ productCount }) {
  return (
    <section className="hero">
      <div className="hero-glow" aria-hidden="true" />
      <div className="hero-grid-bg" aria-hidden="true" />

      <div className="hero-copy">
        <m.span className="eyebrow eyebrow-on-dark" {...rise(0)}>
          <Sparkles size={14} aria-hidden="true" /> The desk collection
        </m.span>
        <m.h1 {...rise(0.06)}>
          Precision gear for the <em>focused</em> desk.
        </m.h1>
        <m.p className="hero-lead" {...rise(0.12)}>
          {productCount ? `${productCount} essentials` : 'Essentials'}: keyboards, audio, displays and power,
          chosen for how they feel day after day. Every order is priced and stock-checked by our servers when you pay.
        </m.p>
        <m.div className="hero-cta" {...rise(0.18)}>
          <Link to="/#catalogue" className="btn btn-accent btn-lg">
            Shop the collection <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <span className="hero-note">
            <ShieldCheck size={16} aria-hidden="true" /> Demo store: payments are simulated
          </span>
        </m.div>
      </div>

      <div className="hero-visual" aria-hidden="true">
        {COLLAGE.map((sku, i) => (
          <m.div
            key={sku}
            className={`hero-tile hero-tile-${i + 1}`}
            initial={{ opacity: 0, y: 30, rotate: 0 }}
            animate={{ opacity: 1, y: 0, rotate: [-4, 3, -2][i] }}
            transition={{ duration: 0.7, delay: 0.15 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
          >
            <ProductImage sku={sku} decorative eager />
          </m.div>
        ))}
      </div>
    </section>
  );
}
