// crypto.randomUUID() only exists in "secure contexts" (HTTPS or localhost).
// The AWS dev deployment is plain HTTP on the ALB's DNS name, so fall back to
// building a v4 UUID from crypto.getRandomValues(), which works everywhere.

export function uuidv4(cryptoImpl = globalThis.crypto) {
  if (typeof cryptoImpl.randomUUID === 'function') return cryptoImpl.randomUUID();

  const b = cryptoImpl.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
