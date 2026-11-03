# How the API should behave

I wrote these rules before the tests. Every expected result in the collection comes from this page, so a test can't quietly decide what "correct" means.

MaxQ is a fictional online shop. Amounts are whole numbers in minor units, so `2150` in GBP means £21.50.

## Endpoints

| Method and path | What it does | Success |
|---|---|---|
| `POST /customers` | Register a customer | 201 |
| `POST /sessions` | Log in and get a bearer token | 201 |
| `POST /orders` | Create an order and work out its total | 201 |
| `POST /payments` | Authorise a payment for an order | 201 |
| `GET /payments/{id}` | Read the payment and its balances | 200 |
| `GET /payments/{id}/history` | Read the transaction history | 200 |
| `POST /payments/{id}/capture` | Ask to take the money | 202 |
| `POST /payments/{id}/refunds` | Ask to return some or all of the money | 202 |
| `POST /simulator/payment-events` | Demo only: pretend the provider sent a notification | 202 |
| `GET /simulator/deliveries/{id}` | Demo only: see how a notification was handled | 200 |

Errors look like `{ "error": { "code": "...", "message": "..." } }`.

## How a payment moves

A 202 means "request accepted", not "money moved". The money moves only when the provider's notification arrives.

```mermaid
stateDiagram-v2
    [*] --> authorised: pm_success
    [*] --> declined: pm_declined
    authorised --> capture_pending: capture requested
    capture_pending --> captured: capture.succeeded
    capture_pending --> capture_failed: capture.failed
    capture_pending --> capture_timed_out: no notification in time
    capture_timed_out --> captured: late capture.succeeded
    capture_timed_out --> capture_failed: late capture.failed
    captured --> partially_refunded: refund.succeeded (part)
    captured --> refunded: refund.succeeded (all)
    partially_refunded --> refunded: refund.succeeded (rest)
```

## Rules

**Balances**

- `refundableMinor` = `capturedMinor` − `refundedMinor` − `pendingRefundMinor`.
- A pending refund reserves its amount straight away, so two refunds in progress can't add up to more than was captured.
- If a refund fails, its reserved amount becomes refundable again.

**Refunds**

- Allowed only once a payment is captured or part-refunded. Otherwise the response is `409 invalid_state`. That includes a payment that has already been refunded in full: there is nothing left to return, so it is the wrong state, not an amount that is too large.
- Asking for more than `refundableMinor` gives `422 refund_exceeds_balance`.
- The amount must be a positive whole number. Otherwise the response is `400 validation_failed`.

**Notifications**

- An `eventId` takes effect once. Sending it again gives the outcome `duplicate` and changes nothing.
- A notification that doesn't fit the current state gives the outcome `rejected` and changes nothing. For example, `capture.failed` can't undo a capture that has settled.
- Only a notification that took effect is remembered. A rejected one is not, so if the provider sends it again once the payment is ready for it, it applies then. (Otherwise a notification that arrived a moment too early would be thrown away as a "duplicate" of something that never happened.)
- The same result sent under a new `eventId` is still caught: a refund that has already settled gives `rejected` with the reason `refund_not_pending`.
- Capture can only be requested once. While a capture is pending, or after it has settled, another request gives `409 invalid_state`.
- With no notification, a capture moves to `capture_timed_out` after 2 seconds in this demo. The timeout means "we don't know yet", not "it failed", so a late notification still counts.
- While the outcome is unknown, refunds are refused.

**Payments and orders**

- A declined payment returns 201 with the status `declined`. It can't be captured, and it doesn't stop the customer trying again.
- An order with a payment that wasn't declined can't be paid again: `409 order_already_paid`.
- An order can have from 1 to 50 lines. Each line is an object with a known `sku` and a `quantity` that is a whole number from 1 to 1000. The currency is `GBP` or `EUR`. Anything else is `400 validation_failed`, and a body that isn't valid JSON is `400 invalid_json`. Bad input never causes a server error, and the order total is always a whole number that can be added up exactly.
- Refund amounts are whole numbers above zero that can be represented exactly. Anything else is `400 validation_failed`.

**Customers**

- Email addresses are matched without regard to case, so `A@x.test` and `a@x.test` are the same customer: registering the second gives `409 email_taken`, and either spelling logs in.
- A password needs at least 8 characters, and a name and email are required. Otherwise the response is `400 validation_failed`.
- A failed login always gives `401 invalid_credentials` with the same message, whether the email is unknown or the password is wrong.

**Access**

- With a missing or invalid token, customer endpoints return `401 unauthenticated`. A refused request changes nothing.
- Another customer's payment or order returns `404 not_found`, not 403, so nobody can use the API to find out which IDs exist. The reply is identical, message included, to the one for an ID that doesn't exist.

**History**

- Each settled capture or refund appears exactly once.
- The order of events is guaranteed. The total number of entries isn't, so the tests don't check it.

## The simulator

The simulator exists only for this demo. It is off unless you turn it on (`ENABLE_SIMULATOR=true` or `--simulator`), and its routes return 404 while it is off. The server listens on `127.0.0.1` unless `HOST` says otherwise. It lets a test choose what happens next: a notification can be late, repeated, failed or never sent.

It tests how MaxQ handles those events. It doesn't prove the API would work with a real payment provider.
