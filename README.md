# A 200 response doesn't mean the money moved

When you test payments, the dangerous bugs often sit behind a successful response. A refund is accepted but never settles. A duplicate notification returns the money twice. A payment says `captured` with the wrong amount, or a test goes green because it checked before the work had finished.

I wanted to show how I test for those problems, using something anyone can run. So this project has a small fictional payments API, MaxQ, and a Postman collection that checks the money, the state changes and the failure handling.

**Skills this shows:** risk-based test design · API testing with Postman and JavaScript · Newman · asynchronous testing with bounded polling · payment state and balance checks · duplicate and idempotent event handling · access control testing · schema validation · config-driven multi-currency runs · testing the tests with seeded defects · GitHub Actions CI

## The short version

| What | Result |
|---|---|
| Scenarios | 16, each able to run alone |
| Checks | 205 in a full run, about 11 seconds |
| Currencies | GBP and EUR, using the same requests |
| Repeat runs | 10 out of 10 passed in a row, with no flaky failures |
| Deliberate bugs | 14 out of 14 caught by the intended scenario ([results](docs/defect-results.md)) |
| Safety guard | Pointed at another host, 0 requests were sent there |

What this does and doesn't prove is in [Limits](#limits).

## Pick your route

- **Hiring manager or product:** read [the risks and decisions](docs/test-design.md), then [the deliberate bugs it caught](docs/defect-results.md). No terminal needed.
- **QA:** read [the API's expected behaviour](docs/api-behaviour.md), then open the [collection](collections/payments.postman_collection.json) in Postman. Scenario 08 is a good place to start.
- **Engineer:** [run it](#run-it-yourself), then look at the [service](src/), the [checks](scripts/) and the [CI workflow](.github/workflows/tests.yml).

## The Playwright version

I also used AI to implement the [same scenarios in Playwright and TypeScript](https://github.com/AlexandraBadescu/maxq-payments-playwright). That project is deliberately AI-assisted: I wanted to compare the tools and review whether the generated implementation still tested the risks I started with.

## How a scenario reads

Scenario 08 tests whether a repeated refund notification returns the money twice:

1. Create a customer, order and payment, then capture it.
2. Request a partial refund, and simulate the provider's notification.
3. Wait until the payment is `partially_refunded`.
4. Send **the same notification again**.
5. Wait until the service reports that it processed the repeat as a `duplicate`.
6. Check the money was refunded once, and the history shows one settled refund.

Step 5 matters most. Without it, the final check could pass only because the duplicate was still in the queue.

## Run it yourself

You need [Node.js](https://nodejs.org) 20 or later.

```bash
npm ci
npm test                 # the full suite in GBP
npm run test:eur         # the same suite in EUR
npm run test:isolation   # each scenario on its own
npm run test:guard       # proves the safety guard works
npm run test:defects     # runs the suite against each deliberate bug
```

`npm test` starts its own copy of the service, and writes a JUnit report to `reports/`.

**To use Postman:** run `npm start`, import the collection and an environment file, then use the Collection Runner. A single Send won't follow the polling steps.

## What's in here

| Path | What it is |
|---|---|
| [`docs/api-behaviour.md`](docs/api-behaviour.md) | The rules, written before the tests |
| [`docs/test-design.md`](docs/test-design.md) | Risks, decisions and what they cost |
| [`docs/defect-results.md`](docs/defect-results.md) | Generated results for the deliberate bugs |
| [`collections/`](collections/) | The Postman collection |
| [`environments/`](environments/) | GBP and EUR settings, with synthetic values only |
| [`src/`](src/) | The demo service |
| [`scripts/`](scripts/) | The test runner and the checks on the tests |

## Limits

- **This is a simulation.** It tests a demo service that I control, and it doesn't show compatibility with any real payment provider.
- **The bugs are ones I chose.** Catching all 14 shows the suite detects those failures, not every possible bug.
- **Scale isn't tested.** The service is in-memory and has no performance, load or concurrency testing.
- **The security checks are narrow.** They cover authentication and access to other customers' payments. This isn't a security review.
- **Newman is the tested runner.** The full results above come from Newman, not from the Postman app.
- **Newman has audit warnings.** `npm audit` reports issues in Newman's own dependencies, which are used only to run these local tests. The demo service's production dependencies report none. Don't point this tooling at untrusted content.

## How it was built

I've built and maintained Postman suites in commercial projects, but those collections and internal APIs aren't mine to publish. I wanted a public example that showed how I approach API quality without sharing anyone else's code or data.

The testing approach, scenarios and original test logic come from my own work. I used AI to help generate the fictional MaxQ API and turn that approach and those tests into a shareable Postman collection format. AI also assisted with the supporting project material. I reviewed the resulting collection and assertions against the behaviour I wanted to test.

Everything here is fictional; no employer code, collections, data or internal API specifications are included. The demo infrastructure is AI-assisted, but the decisions about what matters, what to test and what a meaningful result looks like are mine.

## Licence

See [LICENSE](LICENSE). This work is licensed under CC BY-NC-ND 4.0.
