// k6 performance gate for the TesterGuruJi demo shop.
// If any threshold below fails, k6 exits with code 99 and the CI job fails.
//
// Run locally:
//   k6 run -e BASE_URL=http://localhost:3000 tests/load.js
//   k6 run -e BASE_URL=http://localhost:3000 -e TEST_TYPE=smoke tests/load.js

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

const BASE = __ENV.BASE_URL || 'http://localhost:3000';
const TEST_TYPE = __ENV.TEST_TYPE || 'load';

// Test data: the demo shop's two test users.
const USERS = [
  { username: 'tester', password: 'Test@123' },
  { username: 'tester2', password: 'Test@123' },
];
const SEARCH_TERMS = ['shirt', 'jeans', 'shoes', 'sweater'];

// Two load profiles. CI uses "load" (about 1 minute) so pipelines stay fast.
const PROFILES = {
  smoke: { vus: 1, iterations: 3 },
  load: {
    stages: [
      { duration: '15s', target: 10 }, // ramp up
      { duration: '30s', target: 10 }, // steady
      { duration: '10s', target: 0 }, // ramp down
    ],
  },
};

export const options = {
  ...PROFILES[TEST_TYPE],

  // THE RELEASE GATE. These are the SLAs the build must meet.
  thresholds: {
    // Less than 1% of requests may fail. Stop early if it gets much worse.
    http_req_failed: [{ threshold: 'rate<0.01', abortOnFail: true, delayAbortEval: '10s' }],
    // Overall: 95% of requests under 2 s.
    http_req_duration: ['p(95)<2000'],
    // Per-transaction SLAs, using the "name" tag set on each request below.
    'http_req_duration{name:login}': ['p(95)<500'],
    'http_req_duration{name:search}': ['p(95)<800'],
    'http_req_duration{name:checkout}': ['p(95)<2000'],
    // At least 99% of functional checks must pass.
    checks: ['rate>0.99'],
  },
};

export default function () {
  const user = USERS[__VU % USERS.length];
  const json = { 'Content-Type': 'application/json' };
  let token, csrf, cartId;

  group('01_Login', () => {
    const res = http.post(`${BASE}/api/login`, JSON.stringify(user), {
      headers: json,
      tags: { name: 'login' },
    });
    check(res, { 'login: status 200': (r) => r.status === 200 });
    token = res.json('token'); // correlation
    csrf = res.json('csrfToken'); // correlation
  });
  if (!token) return; // nothing else can work without a session
  const auth = { ...json, Authorization: `Bearer ${token}`, 'X-CSRF-Token': csrf };
  sleep(1);

  group('02_Search', () => {
    const term = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];
    const res = http.get(`${BASE}/api/products?q=${term}`, { headers: auth, tags: { name: 'search' } });
    check(res, {
      'search: status 200': (r) => r.status === 200,
      'search: has results': (r) => r.json('count') > 0,
    });
  });
  sleep(1);

  group('03_AddToCart', () => {
    const cart = http.post(`${BASE}/api/cart`, '{}', { headers: auth, tags: { name: 'create_cart' } });
    check(cart, { 'cart: status 201': (r) => r.status === 201 });
    cartId = cart.json('cartId'); // correlation

    const add = http.post(
      `${BASE}/api/cart/${cartId}/items`,
      JSON.stringify({ productId: 1, qty: 1 }),
      { headers: auth, tags: { name: 'add_item' } },
    );
    check(add, { 'add item: total > 0': (r) => r.json('total') > 0 });
  });
  sleep(1);

  group('04_Checkout', () => {
    const res = http.post(`${BASE}/api/checkout`, JSON.stringify({ cartId }), {
      headers: auth,
      tags: { name: 'checkout' },
    });
    check(res, { 'checkout: confirmed': (r) => r.status === 200 && r.json('status') === 'CONFIRMED' });
  });
  sleep(1);
}

// Writes three outputs: the normal console summary, a JSON file for tools,
// and a Markdown table that CI shows on the job page.
export function handleSummary(data) {
  const rows = Object.entries(data.metrics)
    .filter(([, m]) => m.thresholds)
    .flatMap(([metric, m]) =>
      Object.entries(m.thresholds).map(([rule, t]) => `| \`${metric}\` | \`${rule}\` | ${t.ok ? '✅ pass' : '❌ FAIL'} |`),
    );
  const passed = rows.every((r) => r.includes('pass'));
  const md = [
    `## k6 performance gate: ${passed ? '✅ PASSED' : '❌ FAILED'}`,
    '',
    '| Metric | Threshold | Result |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');

  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
    'results/summary.json': JSON.stringify(data, null, 2),
    'results/summary.md': md,
  };
}
