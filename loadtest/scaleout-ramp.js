// Controlled read-only ramp for the Phase 4 Auto Scaling test.
// Scale-out policy: ALBRequestCountPerTarget > 300/min for 3 consecutive minutes.
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const BASE = __ENV.BASE_URL;
const servedBy = new Counter('served_by');

export const options = {
  scenarios: {
    ramp: {
      executor: 'ramping-arrival-rate',
      timeUnit: '1s',
      startRate: 1,
      preAllocatedVUs: 10,
      maxVUs: 30,
      stages: [
        { duration: '1m', target: 3 },  // warm up
        { duration: '2m', target: 3 },  // ~180 req/min: below the 300 threshold
        { duration: '1m', target: 7 },  // ramp
        { duration: '10m', target: 7 }, // ~420 req/min: above the threshold
      ],
    },
  },
  thresholds: { http_req_failed: ['rate<0.01'] },
};

export default function () {
  if (Math.random() < 0.7) {
    const r = http.get(`${BASE}/api/products?limit=20`, { tags: { name: 'products' } });
    check(r, { 'products 200': (x) => x.status === 200 });
  } else {
    const r = http.get(`${BASE}/api/instance`, { tags: { name: 'instance' } });
    check(r, { 'instance 200': (x) => x.status === 200 });
    if (r.status === 200) servedBy.add(1, { instance: r.json('instanceId') });
  }
}
