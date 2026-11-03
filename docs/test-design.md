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
| A customer reaches someone else's payment | Security and privacy incident | 16, 24 |
| A customer pays for someone else's order | Security incident, and the real owner is locked out | 23 |
| Payment captured twice | Customer charged twice | 17 |
| Refund on a payment with nothing left to refund | Confusing error, or money returned twice | 18 |
| Same refund settled twice under a new event ID | Customer refunded twice | 19 |
| An early notification is thrown away for good | Payment stuck until it times out | 20 |
| Bad order input crashes the service, or gives a wrong total | Server errors, orders with no price | 21 |
| Duplicate or weak accounts, login that reveals which emails exist | Account confusion, privacy | 22 |
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

A payment can say `authorised` and still belong to the wrong order or be in the wrong currency, so the setup step that authorises a payment checks its order, amount and currency as well as its status. A second review found that I hadn't. Two new seeded bugs prove the check works.

A payment can say `captured` and still hold the wrong amount. Payment checks compare the status and balances, and scenario 01 also compares the amounts in the history with the money that moved.

I don't check the total number of history entries, because the rules don't promise one. A check like that would fail on harmless changes.

### Check that a refused request changed nothing

A rejected request can still do damage: a refund that is refused with a 422 but has already reserved some of the balance, or a capture refused with a 401 that went ahead anyway. A status code alone wouldn't show it. So the scenarios that expect a refusal (03, 04, 05, 13, 16, 17, 18) read the payment afterwards and check that the balances and status are exactly what they were.

### Test the business key as well as the event ID

A repeated notification is usually caught by its event ID (scenarios 07 and 08). A provider can also send the same result under a new ID, so scenario 19 does that and checks the refund still settles once.

The same area has a second decision. An early notification that is rejected is not remembered, so if the provider sends it again once the payment is ready, it applies (scenario 20). The first version remembered every event it saw, including rejected ones. That made a notification that arrived a moment early impossible to recover.

### Bad input must never cause a server error

Scenario 21 sends every kind of invalid order I could think of: a `null` item, quantities that are zero, negative, fractional, text, too large or beyond what a number can hold, and bodies that aren't valid JSON. Each must give a 400. The first version of the service crashed on a `null` item, and accepted a quantity so large that the order total came back as `null`.

### Stop a scenario at the first real problem

If capture fails, every later step in that scenario fails too, and the report fills with noise. Setup steps and waits are marked as guards. If one fails, the rest of that scenario is skipped, so the report points at the cause. The wait for a notification now works the same way: if it finishes with the wrong outcome, the rest of that scenario is skipped. Before, the later checks still ran and added failures that all came from the same cause.

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

`npm run test:guard` proves this by pointing the collection at another spelling of the local address (`127.1`) and confirming that no requests arrive and the run fails. The temporary service it uses listens on `127.0.0.1` only. My first version listened on every interface, which a review pointed out; the review suggested `127.0.0.2` instead, but macOS has no such address by default, so I used a name that works everywhere.

The guard checks the host name and nothing else. It doesn't protect against a redirect, or against a different service that happens to be listening on an allowed local address. Treat it as a safety net against pointing the tests at the wrong environment, not as a security boundary.

That check found a bug in my first version. The guard did block every request, but the run finished with no failures, so it looked like a pass. It now records a failed test as well, and the test runner treats a run with no checks as a failure.

## Testing the tests

A passing suite only means something if it would fail when the product is wrong. `npm run test:defects` starts the service with one deliberate bug at a time and checks that the right scenario fails. A failing setup step doesn't count: the scenario has to fail in one of its own checks, because a broken setup would fail the scenario whatever the bug was. The two exceptions are bugs the setup is meant to catch, and the results show the first check that failed in each scenario. The results are in [defect-results.md](defect-results.md).

There's a trap in that, and I fell into it: I wrote the first 14 bugs alongside the tests, so of course the tests caught them. When someone else seeded 10 bugs of their own, this suite caught 3 of them and the Playwright version caught 1. The missing ones are now scenarios 17 to 24 and a fix to 14, and all of those bugs are in the list. The lesson I took from it is that the score against bugs I chose is a floor on my confidence, not a measure of it. I'd want a colleague to keep adding bugs I didn't think of.

## What I'd add next

- 3DS challenges and soft declines, where the payment pauses for cardholder verification and the test needs to handle the redirect and the delayed outcome
- Alternative payment methods (Klarna, PayPal), each with its own authorisation and refund lifecycle
- Webhook signature verification, so the service rejects a notification that wasn't signed by the provider
- Checkout rules: discounts, delivery and invalid addresses, using a data file of inputs and expected totals
- Identity checks using simulated provider callbacks
- An OpenAPI description, checked against the responses
- Consumer-driven contract tests with Pact
- An `Idempotency-Key` on refund requests, so a retried request can't create a second refund
- A failed refund that is reported twice under different event IDs, and a refund result that arrives after a failure for the same refund
- Performance testing, which this project doesn't cover
