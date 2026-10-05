import { useMemo, useState } from 'react';
import { getProductImage } from '../data/productImages.js';

export default function ProductImage({ product, className = 'product-image', priority = false }) {
  const [failed, setFailed] = useState(false);
  const imageUrl = useMemo(() => getProductImage(product), [product]);

  if (failed || !imageUrl) {
    const initials = (product?.name ?? 'NEXORA')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('');

    return (
      <div className={`${className} product-image--fallback`} aria-label={`${product?.name ?? 'Product'} preview`}>
        <span>{initials || 'N'}</span>
      </div>
    );
  }

  return (
    <div className={className}>
      <img
        src={imageUrl}
        alt={product?.name ? `${product.name} preview` : 'Product preview'}
        loading={priority ? 'eager' : 'lazy'}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
