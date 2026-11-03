# How I designed the tests

## Start with what could go wrong

| Risk | What it would mean | Scenarios |
|---|---|---|
| Wrong amount recorded | Finance and customers see different numbers | 01, 02 |
| Refund more than was taken | Direct loss of money | 03, 05 |
| Refund money never taken | Direct loss of money | 04, 11 |
| Same event processed twice | Customer refunded or charged twice | 07, 08 |
| Events arrive in the wrong order | A settled payment gets undone | 09 |
| Notification is late or never comes | Payment stuck, or wrongly treated as failed | 10, 11, 12 |
| Failed refund keeps the money reserved | Customer can't get a valid refund later | 06 |
| Declined payment treated as paid | Goods sent without payment | 13 |
| Order paid twice | Customer charged twice | 14 |
| Someone reaches a payment without logging in | Security incident | 15 |
| A customer reaches someone else's payment | Security and privacy incident | 16 |
| Tests run against the wrong system | Real data changed by a test | [Guard](#the-environment-guard) |

## Decisions, and what they cost

### Poll with a limit, don't wait a fixed time

A fixed wait is a guess. If it's too short, the test fails for no reason. If it's too long, every run is slow.

Each wait here checks every 200 ms, up to 30 times, then fails and reports what it last saw:

```text
Guard: payment reached capture_timed_out
gave up after 30 attempts; last seen: capture_pending
```

**The cost:** Postman only repeats a request in a collection run, so these steps don't work with a single Send.

### Prove a duplicate was processed before checking nothing changed

If a test sends a duplicate and immediately checks the balance, it can pass because the duplicate is still in the queue. That's a false green, and it's the worst kind of result because nobody goes looking.

So scenarios 07 and 08 wait for the service to report the outcome `duplicate`, and only then check the balance.

**The cost:** the simulator needs an extra endpoint that a real provider wouldn't have.

### Check the money as well as the status

A payment can say `captured` and still hold the wrong amount. Payment checks compare the status and balances, and scenario 01 also compares the amounts in the history with the money that moved.

I don't check the total number of history entries, because the rules don't promise one. A check like that would fail on harmless changes.

### Stop a scenario at the first real problem

If capture fails, every later step in that scenario fails too, and the report fills with noise. Setup steps and waits are marked as guards. If one fails, the rest of that scenario is skipped, so the report points at the cause.

**The cost:** a run can show fewer failures than exist. Fixing the first one may reveal another.

### Keep each scenario independent

Each scenario creates its own customer, order and payment, and clears the previous scenario's IDs first. `npm run test:isolation` runs each one alone to prove it.

That repeats four setup requests in every scenario. I accepted that because a reader can see everything a scenario needs, and any scenario can be run alone.

There's no clean-up step because the service keeps everything in memory, and each test run gets a fresh copy. A shared environment would need one.

### Make a schema check fail if the schema is missing

A schema check that passes when the schema can't be found looks like coverage but checks nothing. `expectSchema` fails in that case.

The payment schema also rejects unexpected fields, which would catch an internal field such as `customerId` leaking into a response.

A schema check confirms the response's structure. It isn't consumer-driven contract testing, which would need the API's consumers to define what they expect.

### Keep helpers inside the collection

The helpers live in the collection's own scripts. Nothing is downloaded at run time, there's no `eval`, and no test relies on a public service.

One detail caught me out. The first version of the polling helper paused using a timer, and the wait never happened: 30 attempts finished almost instantly, and the timeout scenarios failed. Postman's sandbox only waits for timers started by the script currently running, and the helper belonged to an earlier one. The pause now sits in the collection's pre-request script.

### Use configuration for currency

The requests don't change between GBP and EUR. Each environment file supplies the currency and the expected total, and CI runs both, with a separate report for each. Adding a currency to the service and a new environment file wouldn't need any new requests.

### The environment guard

These tests create and refund payments. Before every request, the collection checks that `baseUrl` is `localhost` or `127.0.0.1`. If it isn't, the request is skipped and the run fails.

`npm run test:guard` proves this by pointing the collection at another address and confirming that no requests arrive and the run fails.

That check found a bug in my first version. The guard did block every request, but the run finished with no failures, so it looked like a pass. It now records a failed test as well, and the test runner treats a run with no checks as a failure.

## Testing the tests

A passing suite only means something if it would fail when the product is wrong. `npm run test:defects` starts the service with one deliberate bug at a time and checks that the right scenario fails. The results are in [defect-results.md](defect-results.md).

## What I'd add next

- 3DS challenges and soft declines, where the payment pauses for cardholder verification and the test needs to handle the redirect and the delayed outcome
- Alternative payment methods (Klarna, PayPal), each with its own authorisation and refund lifecycle
- Webhook signature verification, so the service rejects a notification that wasn't signed by the provider
- Checkout rules: discounts, delivery and invalid addresses, using a data file of inputs and expected totals
- Identity checks using simulated provider callbacks
- An OpenAPI description, checked against the responses
- Consumer-driven contract tests with Pact
- An `Idempotency-Key` on refund requests, so a retried request can't create a second refund
- Performance testing, which this project doesn't cover
