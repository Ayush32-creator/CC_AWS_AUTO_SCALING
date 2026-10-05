// Phase 6 load test (docs/10-load-testing.md).
// Three sequential scenarios against the ALB, read-only but database-backed:
//   baseline   ~2 req/s for 3 min   (~120 req/min: well below the 300 req/target/min scale-out target)
//   ramp       2 -> 7 req/s in 1 min
//   sustained  ~7 req/s for 15 min  (~420 req/min: above 300 per target with 1 instance,
//                                     ~210 per target once a second instance is in service)
// No orders are created (stock is not consumed); checkout is validated separately.
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL;
// Fail fast: an empty URL would turn every request into a local error.
if (!/^https?:\/\/[^/]+/.test(BASE || '')) {
  throw new Error(`BASE_URL must be the ALB URL (terraform output app_url), got "${BASE}"`);
}

export const options = {
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    baseline: {
      executor: 'constant-arrival-rate',
      rate: 2, timeUnit: '1s', duration: '3m',
      preAllocatedVUs: 5, maxVUs: 20,
    },
    ramp: {
      executor: 'ramping-arrival-rate',
      startTime: '3m', startRate: 2, timeUnit: '1s',
      stages: [{ duration: '1m', target: 7 }],
      preAllocatedVUs: 10, maxVUs: 30,
    },
    sustained: {
      executor: 'constant-arrival-rate',
      startTime: '4m', rate: 7, timeUnit: '1s', duration: '15m',
      preAllocatedVUs: 10, maxVUs: 30,
    },
  },
  // Per-scenario thresholds make k6 report each phase separately in the summary.
  thresholds: {
    'http_req_failed{scenario:baseline}': ['rate<0.01'],
    'http_req_failed{scenario:ramp}': ['rate<0.01'],
    'http_req_failed{scenario:sustained}': ['rate<0.01'],
    'http_req_duration{scenario:baseline}': ['p(95)<2000'],
    'http_req_duration{scenario:ramp}': ['p(95)<2000'],
    'http_req_duration{scenario:sustained}': ['p(95)<2000'],
  },
};

const quoteBody = JSON.stringify({ items: [{ productId: 1, quantity: 1 }, { productId: 3, quantity: 2 }] });

export default function () {
  const r = Math.random();
  let res;
  if (r < 0.5) {
    res = http.get(`${BASE}/api/products?limit=20`, { tags: { name: 'products' } });
  } else if (r < 0.7) {
    res = http.get(`${BASE}/api/products/${1 + Math.floor(Math.random() * 12)}`, { tags: { name: 'product' } });
  } else if (r < 0.85) {
    res = http.post(`${BASE}/api/cart/quote`, quoteBody, { headers: { 'Content-Type': 'application/json' }, tags: { name: 'quote' } });
  } else {
    res = http.get(`${BASE}/api/instance`, { tags: { name: 'instance' } });
  }
  check(res, { 'status 200': (x) => x.status === 200 });
}

// RESULTS_DIR: loadtest/results when run natively from the repo root,
// /results when run in the grafana/k6 container with that directory mounted.
export function handleSummary(data) {
  const dir = __ENV.RESULTS_DIR || 'loadtest/results';
  return { [`${dir}/phase6-k6-summary.json`]: JSON.stringify(data, null, 2) };
}
