// Product photo mapping, keyed by SKU (stable across databases, unlike the
// serial product id). Images live in public/products/ and are served by the
// app itself, so no external image service is needed.
//
// To move the photos to S3/CloudFront or Cloudinary later, either set
// VITE_PRODUCT_IMAGE_BASE_URL at build time, or store full URLs in the
// products.image_url column: a product's own imageUrl always wins.
// Photo credits: public/products/credits.json.

const BASE_URL = (import.meta.env.VITE_PRODUCT_IMAGE_BASE_URL ?? '/products').replace(/\/$/, '');

export const PRODUCT_IMAGES = {
  'KB-MECH-01': { file: 'kb-mech-01.webp', alt: 'Black compact mechanical keyboard with a coiled cable on a grey desk mat' },
  'MS-WL-02': { file: 'ms-wl-02.webp', alt: 'Graphite and black cordless mouse on a white surface' },
  'HP-ANC-03': { file: 'hp-anc-03.webp', alt: 'Black over-ear headphones resting on a grey surface' },
  'MN-27-04': { file: 'mn-27-04.webp', alt: 'Flat-panel monitor on a stand in the middle of a tidy desk' },
  'WC-1080-05': { file: 'wc-1080-05.webp', alt: 'Webcam clipped to the top of a monitor' },
  'SSD-1TB-06': { file: 'ssd-1tb-06.webp', alt: '1 TB PCIe 4.0 NVMe M.2 SSD on a white background' },
  'HUB-USBC-07': { file: 'hub-usbc-07.webp', alt: 'Black USB hub with seven ports and individual switches' },
  'LS-ALU-08': { file: 'ls-alu-08.webp', alt: 'Laptop raised on a minimalist stand on a wooden desk' },
  'DM-XL-09': { file: 'dm-xl-09.webp', alt: 'Large charcoal desk mat with a keyboard and mouse' },
  'CH-65W-10': { file: 'ch-65w-10.webp', alt: 'Compact black GaN travel charger with USB-C ports' },
  'SPK-BT-11': { file: 'spk-bt-11.webp', alt: 'Grey portable Bluetooth speaker with a wrist strap' },
  'LMP-LED-12': { file: 'lmp-led-12.webp', alt: 'White balanced-arm desk lamp clamped to a wooden desk' },
};

/** Resolve `{ src, alt }` for a product, or null when no image is known. */
export function getProductImage({ sku, imageUrl } = {}) {
  if (imageUrl) return { src: imageUrl, alt: null };
  const entry = sku && PRODUCT_IMAGES[sku];
  return entry ? { src: `${BASE_URL}/${entry.file}`, alt: entry.alt } : null;
}
