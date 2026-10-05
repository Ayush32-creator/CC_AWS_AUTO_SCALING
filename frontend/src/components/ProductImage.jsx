import { useState } from 'react';
import { getProductImage } from '../lib/productImages.js';

/**
 * Product photo with lazy loading and a branded fallback tile when there is no
 * image (or it fails to load). `decorative` hides it from screen readers where
 * the product name is already next to it.
 */
export default function ProductImage({ sku, imageUrl, name = '', className = '', decorative = false, eager = false }) {
  const image = getProductImage({ sku, imageUrl });
  const [failedSrc, setFailedSrc] = useState(null);

  if (!image || failedSrc === image.src) {
    const initials = name
      .split(/\s+/)
      .filter((w) => /[a-z0-9]/i.test(w))
      .slice(0, 2)
      .map((w) => w.replace(/[^a-z0-9]/gi, '')[0])
      .join('')
      .toUpperCase();
    return (
      <div className={`pimg pimg-fallback ${className}`} role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : name} aria-hidden={decorative || undefined}>
        <span>{initials || 'N'}</span>
      </div>
    );
  }

  return (
    <div className={`pimg ${className}`}>
      <img
        src={image.src}
        alt={decorative ? '' : (image.alt ?? name)}
        width="800"
        height="600"
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        onError={() => setFailedSrc(image.src)}
      />
    </div>
  );
}
