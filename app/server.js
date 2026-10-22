// TesterGuruJi demo shop API. Zero dependencies: run with `node server.js`.
// Contains DELIBERATE bugs for teaching. Run only on localhost / a test machine.
// See ../PRESENTER_NOTES.md for the list of planted bugs.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const CHECKOUT_EXTRA_MS = Number(process.env.CHECKOUT_EXTRA_MS) || 0;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---- Fake seed data (no real people) ------------------------------------
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const users = {
  tester: {
    id: 1001, username: 'tester', password: 'Test@123', name: 'Demo Tester',
    email: 'demo.tester@example.com', phone: '+91-90000-00001', role: 'customer',
    internalNotes: 'VIP pricing tier B; credit limit 50000', passwordHash: sha('Test@123'),
  },
  tester2: {
    id: 1002, username: 'tester2', password: 'Test@123', name: 'Second Tester',
    email: 'second.tester@example.com', phone: '+91-90000-00002', role: 'customer',
    internalNotes: 'Flagged for manual review', passwordHash: sha('Test@123'),
  },
};

const products = [
  { id: 1, name: 'Cotton Shirt', price: 799 },
  { id: 2, name: 'Denim Jeans', price: 1499 },
  { id: 3, name: 'Running Shoes', price: 2999 },
  { id: 4, name: 'Shirt Hanger Pack', price: 199 },
  { id: 5, name: 'Wool Sweater', price: 1899 },
  { id: 6, name: 'Formal Shirt', price: 1199 },
];

const sessions = {}; // token -> { username, csrf }
const carts = {}; // cartId -> { owner, items: [] }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (min, max) => Math.floor(min + Math.random() * (max - min));
const summarise = (cart) => ({
  items: cart.items,
  total: cart.items.reduce((sum, i) => sum + i.price * i.qty, 0),
});

// ---- Tiny HTTP helpers ----------------------------------------------------
function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); }
    });
  });
}

function authenticate(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const session = sessions[token];
  return session ? { session, user: users[session.username] } : null;
}

function serveStatic(req, res) {
  const file = req.url === '/' ? 'index.html' : req.url.split('?')[0].replace(/^\/+/, '');
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full)) {
    return send(res, 404, { error: 'Not found' });
  }
  const type = full.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  fs.createReadStream(full).pipe(res);
}

// ---- Routes -------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const m = req.method;

  if (!p.startsWith('/api/')) return serveStatic(req, res);
  if (m === 'GET' && p === '/api/health') return send(res, 200, { status: 'ok' });

  // Login: returns a dynamic token and CSRF token (correlation practice).
  if (m === 'POST' && p === '/api/login') {
    await sleep(rand(80, 200));
    const { username, password } = await readJson(req);
    const user = users[username];
    if (!user || user.password !== password) return send(res, 401, { error: 'Invalid credentials' });
    const token = crypto.randomBytes(16).toString('hex');
    const csrfToken = crypto.randomBytes(8).toString('hex');
    sessions[token] = { username, csrf: csrfToken };
    return send(res, 200, { token, csrfToken, user: { id: user.id, name: user.name } }, { 'X-CSRF-Token': csrfToken });
  }

  const auth = authenticate(req);
  if (!auth) return send(res, 401, { error: 'Unauthorized' });
  const csrfOk = req.headers['x-csrf-token'] === auth.session.csrf;

  // Search: normal latency, slower for very short (broad) queries.
  if (m === 'GET' && p === '/api/products') {
    const q = String(url.searchParams.get('q') || '').toLowerCase();
    await sleep(q.length < 2 ? rand(400, 900) : rand(60, 250));
    const results = products.filter((x) => x.name.toLowerCase().includes(q));
    return send(res, 200, { count: results.length, results });
  }

  // PLANTED BUG 1 (data exposure): the page shows only the name, but this
  // returns email, phone, role, internal notes and the password hash.
  if (m === 'GET' && p === '/api/profile') {
    await sleep(rand(50, 150));
    const { password, ...rest } = auth.user;
    return send(res, 200, rest);
  }

  // Create cart: needs the CSRF header (correlation practice).
  if (m === 'POST' && p === '/api/cart') {
    if (!csrfOk) return send(res, 403, { error: 'Invalid CSRF token' });
    await sleep(rand(80, 200));
    const cartId = 'C' + crypto.randomBytes(4).toString('hex');
    carts[cartId] = { owner: auth.session.username, items: [] };
    return send(res, 201, { cartId });
  }

  // PLANTED BUG 2 (validation): zero or negative quantity is accepted,
  // so the cart total can go negative.
  let match = p.match(/^\/api\/cart\/([^/]+)\/items$/);
  if (m === 'POST' && match) {
    if (!csrfOk) return send(res, 403, { error: 'Invalid CSRF token' });
    await sleep(rand(80, 200));
    const cart = carts[match[1]];
    if (!cart) return send(res, 404, { error: 'Cart not found' });
    const { productId, qty } = await readJson(req);
    const product = products.find((x) => x.id === Number(productId));
    if (!product) return send(res, 400, { error: 'Unknown product' });
    cart.items.push({ productId: product.id, name: product.name, price: product.price, qty: Number(qty) });
    return send(res, 200, summarise(cart));
  }

  // PLANTED BUG 3 (broken access control): any logged-in user can read any cart by ID.
  match = p.match(/^\/api\/cart\/([^/]+)$/);
  if (m === 'GET' && match) {
    await sleep(rand(40, 120));
    const cart = carts[match[1]];
    if (!cart) return send(res, 404, { error: 'Cart not found' });
    return send(res, 200, { owner: cart.owner, ...summarise(cart) });
  }

  // PLANTED BUG 4 (error leak + slow endpoint): checkout takes 700-1500 ms,
  // and an unknown cart ID crashes with the stack trace in the response.
  if (m === 'POST' && p === '/api/checkout') {
    if (!csrfOk) return send(res, 403, { error: 'Invalid CSRF token' });
    const body = await readJson(req);
    // DEMO SWITCH for the CI video: CHECKOUT_EXTRA_MS simulates a developer
    // shipping a slower checkout. 0 = normal; 1500 = the release gate should fail.
    await sleep(rand(700, 1500) + CHECKOUT_EXTRA_MS);
    try {
      const cart = carts[body.cartId];
      const total = cart.items.reduce((sum, i) => sum + i.price * i.qty, 0); // throws if cart is undefined
      const orderId = 'O' + crypto.randomBytes(4).toString('hex');
      delete carts[body.cartId];
      return send(res, 200, { orderId, total, status: 'CONFIRMED' });
    } catch (err) {
      return send(res, 500, { error: err.message, stack: err.stack });
    }
  }

  return send(res, 404, { error: 'Not found' });
}

function createServer() {
  return http.createServer((req, res) => {
    handle(req, res).catch((err) => send(res, 500, { error: err.message }));
  });
}

if (require.main === module) {
  createServer().listen(PORT, '127.0.0.1', () => {
    console.log(`Demo shop running at http://localhost:${PORT}`);
    console.log('Test login: tester / Test@123  (deliberately buggy, local use only)');
  });
}

module.exports = { createServer };
