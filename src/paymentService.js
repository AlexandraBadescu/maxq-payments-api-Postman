'use strict';

const { randomUUID } = require('node:crypto');

class ApiError extends Error {
  constructor(httpStatus, code, message) {
    super(message);
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

/**
 * The payment state machine. See docs/api-behaviour.md for the rules it
 * implements. Amounts are always integers in minor units (pence, cents).
 */
class PaymentService {
  constructor({ captureTimeoutMs, hasDefect }) {
    this.captureTimeoutMs = captureTimeoutMs;
    this.hasDefect = hasDefect;
    this.payments = new Map();
    this.processedEventIds = new Set();
  }

  find(paymentId) {
    return this.payments.get(paymentId);
  }

  authorise(order, paymentMethod) {
    const alreadyPaid = [...this.payments.values()].some(
      (p) =>
        p.orderId === order.id && (p.status !== 'declined' || this.hasDefect('declined-blocks-retry')),
    );
    if (alreadyPaid && !this.hasDefect('double-payment-allowed')) {
      throw new ApiError(409, 'order_already_paid', 'This order already has a payment.');
    }

    const status = paymentMethod === 'pm_declined' ? 'declined' : 'authorised';
    const payment = {
      id: randomUUID(),
      orderId: order.id,
      customerId: order.customerId,
      status,
      currency: order.currency,
      amountMinor: order.totalMinor,
      capturedMinor: 0,
      refundedMinor: 0,
      pendingRefundMinor: 0,
      refunds: [],
      history: [],
    };
    this.payments.set(payment.id, payment);
    this.#record(payment, `payment_${status}`, { from: null, amountMinor: payment.amountMinor });
    return payment;
  }

  requestCapture(payment) {
    const capturable =
      payment.status === 'authorised' ||
      (payment.status === 'declined' && this.hasDefect('declined-payment-captured')) ||
      (['capture_pending', 'captured'].includes(payment.status) &&
        this.hasDefect('double-capture-allowed'));
    if (!capturable) {
      throw new ApiError(409, 'invalid_state', `A ${payment.status} payment cannot be captured.`);
    }

    this.#transition(payment, 'capture_pending', 'capture_requested');

    if (this.hasDefect('captured-on-request')) {
      payment.capturedMinor = payment.amountMinor;
      this.#transition(payment, 'captured', 'capture_settled', {
        amountMinor: payment.amountMinor,
      });
      return payment;
    }

    if (!this.hasDefect('capture-timeout-missing')) {
      setTimeout(() => {
        if (payment.status === 'capture_pending') {
          this.#transition(payment, 'capture_timed_out', 'capture_timed_out');
        }
      }, this.captureTimeoutMs).unref();
    }
    return payment;
  }

  requestRefund(payment, amountMinor) {
    // A fully refunded payment has nothing left to refund, so it is an invalid state
    // like any other, not a "too large" amount (docs/api-behaviour.md).
    const refundableStatuses = ['captured', 'partially_refunded'];
    if (this.hasDefect('refunded-payment-refundable')) refundableStatuses.push('refunded');
    const refundable = refundableStatuses.includes(payment.status);
    if (!refundable && !this.hasDefect('refund-before-capture-allowed')) {
      throw new ApiError(409, 'invalid_state', `A ${payment.status} payment cannot be refunded.`);
    }
    const limitEnforced =
      !this.hasDefect('refund-limit-ignored') && !this.hasDefect('refund-before-capture-allowed');
    const limit = this.hasDefect('reservation-ignored-in-limit')
      ? payment.capturedMinor - payment.refundedMinor
      : refundableMinor(payment);
    if (limitEnforced && amountMinor > limit) {
      throw new ApiError(422, 'refund_exceeds_balance', `Only ${limit} can be refunded.`);
    }

    const refund = { id: randomUUID(), amountMinor, status: 'pending' };
    payment.refunds.push(refund);
    payment.pendingRefundMinor += amountMinor;
    this.#record(payment, 'refund_requested', { amountMinor, refundId: refund.id });
    return refund;
  }

  /**
   * Handle one provider notification. Returns how it was handled, so the demo
   * can show whether a duplicate was actually processed and not just queued.
   */
  applyEvent(event) {
    const reapply = this.hasDefect('duplicate-events-reapplied');
    if (this.processedEventIds.has(event.eventId) && !reapply) {
      return { status: 'duplicate', reason: 'event_already_processed' };
    }

    const payment = this.payments.get(event.paymentId);
    const handlers = {
      'capture.succeeded': () => this.#captureSucceeded(payment, event, reapply),
      'capture.failed': () => this.#captureFailed(payment, event),
      'refund.succeeded': () => this.#refundSucceeded(payment, event, reapply),
      'refund.failed': () => this.#refundFailed(payment, event),
    };
    const outcome = handlers[event.type]();

    // Only an event that took effect is remembered. A rejected one changed nothing, so
    // if the provider sends it again once the payment is ready for it, it can still apply.
    if (outcome.status === 'applied' || this.hasDefect('rejected-event-consumes-id')) {
      this.processedEventIds.add(event.eventId);
    }
    return outcome;
  }

  #captureSucceeded(payment, event, reapply) {
    const allowed = ['capture_pending'];
    if (!this.hasDefect('late-capture-rejected')) allowed.push('capture_timed_out');
    if (reapply && payment.status === 'captured') allowed.push('captured');
    if (!allowed.includes(payment.status)) return rejected('invalid_transition');

    payment.capturedMinor += payment.amountMinor;
    this.#transition(payment, 'captured', 'capture_settled', {
      amountMinor: payment.amountMinor,
      eventId: event.eventId,
    });
    if (this.hasDefect('capture-history-duplicated')) {
      this.#record(payment, 'capture_settled', {
        amountMinor: payment.amountMinor,
        eventId: event.eventId,
      });
    }
    return applied();
  }

  #captureFailed(payment, event) {
    const allowed = ['capture_pending', 'capture_timed_out'];
    if (this.hasDefect('out-of-order-event-applied')) allowed.push('captured');
    if (!allowed.includes(payment.status)) return rejected('invalid_transition');

    payment.capturedMinor = 0;
    this.#transition(payment, 'capture_failed', 'capture_failed', { eventId: event.eventId });
    return applied();
  }

  #refundSucceeded(payment, event, reapply) {
    const refund = payment.refunds.find((r) => r.id === event.refundId);
    if (!refund) return rejected('unknown_refund');
    const settleAgain = reapply || this.hasDefect('refund-reapplied-by-new-event');
    if (refund.status !== 'pending' && !settleAgain) return rejected('refund_not_pending');

    if (refund.status === 'pending') payment.pendingRefundMinor -= refund.amountMinor;
    refund.status = 'succeeded';
    payment.refundedMinor += this.hasDefect('refunded-total-wrong')
      ? payment.capturedMinor
      : refund.amountMinor;

    const from = payment.status;
    payment.status =
      payment.refundedMinor >= payment.capturedMinor ? 'refunded' : 'partially_refunded';
    if (!this.hasDefect('history-entry-missing')) {
      this.#record(payment, 'refund_settled', {
        from,
        amountMinor: refund.amountMinor,
        refundId: refund.id,
        eventId: event.eventId,
      });
    }
    return applied();
  }

  #refundFailed(payment, event) {
    const refund = payment.refunds.find((r) => r.id === event.refundId);
    if (!refund) return rejected('unknown_refund');
    if (refund.status !== 'pending') return rejected('refund_not_pending');

    refund.status = 'failed';
    if (!this.hasDefect('failed-refund-keeps-reservation')) {
      payment.pendingRefundMinor -= refund.amountMinor;
    }
    this.#record(payment, 'refund_failed', {
      amountMinor: refund.amountMinor,
      refundId: refund.id,
      eventId: event.eventId,
    });
    return applied();
  }

  #transition(payment, toStatus, entryType, details = {}) {
    const from = payment.status;
    payment.status = toStatus;
    this.#record(payment, entryType, { ...details, from });
  }

  #record(payment, type, { from = payment.status, ...details }) {
    payment.history.push({
      at: new Date().toISOString(),
      type,
      fromStatus: from,
      toStatus: payment.status,
      ...details,
    });
  }
}

function refundableMinor(payment) {
  return payment.capturedMinor - payment.refundedMinor - payment.pendingRefundMinor;
}

function applied() {
  return { status: 'applied' };
}

function rejected(reason) {
  return { status: 'rejected', reason };
}

function publicPayment(payment) {
  const { customerId, history, refunds, ...visible } = payment;
  return {
    ...visible,
    refundableMinor: refundableMinor(payment),
    refunds: refunds.map((refund) => ({ ...refund })),
  };
}

module.exports = { ApiError, PaymentService, publicPayment };
