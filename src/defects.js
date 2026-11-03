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
