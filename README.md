# k6 Performance Gate in CI/CD (TesterGuruJi demo)

A load test that **blocks a release** when performance drops. If any k6
threshold fails, `k6 run` exits with code **99**, so GitHub Actions or Jenkins
marks the build red.

```
k6-ci-gate/
├── app/                          Demo shop (zero dependencies), the app under test
├── tests/load.js                 k6 test: login → search → cart → checkout, with thresholds
├── .github/workflows/perf-gate.yml   GitHub Actions pipeline
├── Jenkinsfile                   Jenkins pipeline (local k6 or Docker)
└── README.md
```
> The demo shop is deliberately buggy. Run it on localhost or CI only.

## 1. Run it locally

Install k6 ([official install guide](https://grafana.com/docs/k6/latest/set-up/install-k6/)) and Node.js 18+.

```bash
# Terminal 1: start the app
node app/server.js

# Terminal 2: run the gate
k6 run -e BASE_URL=http://localhost:3000 tests/load.js
echo $?          # 0 = passed
```

**Make it fail (the "bad release"):**

```bash
CHECKOUT_EXTRA_MS=1500 node app/server.js
k6 run -e BASE_URL=http://localhost:3000 tests/load.js
echo $?          # 99 = a threshold failed
```

On Windows PowerShell: `$env:CHECKOUT_EXTRA_MS=1500; node app/server.js` and `echo $LASTEXITCODE`.

Quick check without load: add `-e TEST_TYPE=smoke` (1 user, 3 iterations).

## 2. The thresholds (the SLA)

| Threshold | Meaning |
| --- | --- |
| `http_req_failed: rate<0.01` | Under 1% errors; aborts early if errors spike |
| `http_req_duration: p(95)<2000` | 95% of all requests under 2 s |
| `http_req_duration{name:login}: p(95)<500` | Login under 0.5 s |
| `http_req_duration{name:search}: p(95)<800` | Search under 0.8 s |
| `http_req_duration{name:checkout}: p(95)<2000` | Checkout under 2 s |
| `checks: rate>0.99` | 99% of functional checks pass |

Results are written to `results/summary.json` and `results/summary.md`
(a pass/fail table shown on the GitHub job page).

## 3. GitHub Actions

1. Push this folder to a new GitHub repo (branch `main`).
2. The workflow runs on every push and pull request.
3. **Make it a real gate:** Settings → Branches → add a rule for `main` →
   *Require status checks to pass* → select **k6-load-test**. Now a red
   pipeline blocks the merge.
4. **Demo the failure without editing code:** Actions → *Performance gate* →
   *Run workflow* → set `checkout_extra_ms` to `1500`.

Or, for the video, open a pull request that changes the checkout delay in
`app/server.js` from `rand(700, 1500)` to `rand(2200, 3000)` and watch it go red.

## 4. Jenkins

1. New Item → Pipeline → *Pipeline script from SCM* → point at your repo.
2. Agent needs Node.js and k6 (or tick **USE_DOCKER** to use `grafana/k6`).
3. *Build with Parameters*: `CHECKOUT_EXTRA_MS=0` passes, `1500` fails.

## Tested

The app, the k6 script's syntax and the workflow YAML were checked, and the
same request flow was replayed with 10 users: the normal build passed every
threshold (checkout p95 about 1.5 s), and `CHECKOUT_EXTRA_MS=1500` failed the
overall and checkout thresholds (checkout p95 about 2.9 s). Do one real k6 run
on your machine before recording.
