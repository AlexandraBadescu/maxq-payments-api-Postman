'use strict';

/**
 * Deliberate bugs that can be switched on with SEEDED_DEFECT=<name>.
 *
 * They exist for one reason: to check that the test suite fails when the
 * product is wrong. scripts/check-defects.js starts the service with each one
 * in turn and records which scenarios caught it.
 */
const DEFECTS = Object.freeze({
  'auth-not-required': 'Requests with no token are accepted',
  'ownership-not-checked': "One customer can read and act on another customer's payment",
  'declined-payment-captured': 'A declined payment can be captured',
  'double-payment-allowed': 'An order can be paid for twice',
  'captured-on-request': 'A capture is marked as captured before the provider confirms it',
  'capture-timeout-missing': 'A capture with no notification stays pending for ever',
  'late-capture-rejected': 'A late success after a timeout is thrown away',
  'duplicate-events-reapplied': 'A repeated notification moves the money a second time',
  'out-of-order-event-applied': 'A failure notification can reverse a settled capture',
  'refund-limit-ignored': 'A refund can exceed the captured balance',
  'refund-before-capture-allowed': 'A refund can be requested before capture',
  'refunded-total-wrong': 'A partial refund is recorded as a full refund',
  'failed-refund-keeps-reservation': 'A failed refund never releases the reserved balance',
  'history-entry-missing': 'A settled refund is missing from the transaction history',
  'reservation-ignored-in-limit': 'A refund limit ignores refunds already in progress',
  'capture-history-duplicated': 'A settled capture appears twice in the transaction history',
  'order-ownership-not-checked': "A customer can pay for another customer's order",
  'double-capture-allowed': 'A payment that is already captured, or being captured, can be captured again',
  'login-accepts-any-password': 'Login accepts any password',
  'declined-blocks-retry': 'A declined attempt blocks a retry on the same order',
  'quantity-not-validated': 'An order quantity of zero or below is accepted',
  'quantity-unbounded': 'An order quantity has no upper limit',
  'null-item-crashes': 'An order item that is null crashes the service',
  'email-not-unique': 'The same email address can register twice',
  'email-case-sensitive': 'Email addresses that differ only in case register as different customers',
  'weak-password-allowed': 'A one-character password is accepted',
  'refund-reapplied-by-new-event': 'A second event with a new ID settles the same refund again',
  'refunded-payment-refundable': 'A fully refunded payment gives a too-large error, not an invalid-state one',
  'rejected-event-consumes-id': 'A rejected event can never be applied when the provider sends it again',
  'ownership-leak-via-message': "Another customer's payment gets a different 404 message",
  'payment-wrong-currency': 'A new payment is created in a different currency from its order',
  'payment-wrong-order': 'A new payment is linked to a different order from the one paid for',
});

function loadDefect(name) {
  if (!name) return () => false;
  if (!Object.hasOwn(DEFECTS, name)) {
    throw new Error(`Unknown SEEDED_DEFECT "${name}". Known: ${Object.keys(DEFECTS).join(', ')}`);
  }
  console.warn(`SEEDED DEFECT ACTIVE: ${name} - ${DEFECTS[name]}`);
  return (candidate) => candidate === name;
}

module.exports = { DEFECTS, loadDefect };
