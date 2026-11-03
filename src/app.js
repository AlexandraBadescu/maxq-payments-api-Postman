'use strict';

const { randomUUID, scryptSync, randomBytes, timingSafeEqual } = require('node:crypto');
const express = require('express');
const { loadDefect } = require('./defects');
const { ApiError, PaymentService, publicPayment } = require('./paymentService');

const CATALOGUE = Object.freeze({
  'MAXQ-BOX-S': { GBP: 450, EUR: 520 },
  'MAXQ-BOX-L': { GBP: 1250, EUR: 1450 },
});
const EVENT_TYPES = ['capture.succeeded', 'capture.failed', 'refund.succeeded', 'refund.failed'];
const MAX_EVENT_DELAY_MS = 5000;
const MAX_ITEMS_PER_ORDER = 50;
const MAX_QUANTITY_PER_ITEM = 1000;
const MIN_PASSWORD_LENGTH = 8;

function hashPassword(password, salt = randomBytes(16)) {
  return { salt, hash: scryptSync(password, salt, 32) };
}

// Safe integers only: a value past Number.MAX_SAFE_INTEGER cannot be added up exactly.
function isPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

// Email addresses are matched without regard to case, so "A@x.test" and
// "a@x.test" are the same customer.
function normaliseEmail(email) {
  return email.trim().toLowerCase();
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function badRequest(message) {
  return new ApiError(400, 'validation_failed', message);
}

function createApp({
  captureTimeoutMs = 2000,
  enableSimulator = false,
  seededDefect = undefined,
} = {}) {
  const hasDefect = loadDefect(seededDefect);
  const paymentService = new PaymentService({ captureTimeoutMs, hasDefect });
  const customersByEmail = new Map();
  const sessions = new Map();
  const orders = new Map();
  const deliveries = new Map();

  const app = express();
  app.use(express.json());

  function requireCustomer(req, _res, next) {
    const token = (req.get('authorization') || '').replace(/^Bearer /, '');
    const customerId = sessions.get(token);
    if (customerId) {
      req.customerId = customerId;
      return next();
    }
    if (!token && hasDefect('auth-not-required')) {
      req.customerId = 'anonymous';
      return next();
    }
    throw new ApiError(401, 'unauthenticated', 'A valid bearer token is required.');
  }

  // A resource owned by someone else returns 404, not 403, so that callers
  // cannot use the API to discover which IDs exist.
  function loadOwnedPayment(req, _res, next) {
    const payment = paymentService.find(req.params.id);
    const visible =
      payment && (payment.customerId === req.customerId || hasDefect('ownership-not-checked'));
    if (!visible) {
      const message =
        payment && hasDefect('ownership-leak-via-message')
          ? 'Payment belongs to another customer.'
          : 'Payment not found.';
      throw new ApiError(404, 'not_found', message);
    }
    req.payment = payment;
    next();
  }

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  const emailKey = (email) => (hasDefect('email-case-sensitive') ? email : normaliseEmail(email));

  app.post('/customers', (req, res) => {
    const { name, email, password } = req.body ?? {};
    if (![name, email, password].every(isNonEmptyString)) {
      throw badRequest('name, email and password are required.');
    }
    if (password.length < MIN_PASSWORD_LENGTH && !hasDefect('weak-password-allowed')) {
      throw badRequest(`password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    if (customersByEmail.has(emailKey(email)) && !hasDefect('email-not-unique')) {
      throw new ApiError(409, 'email_taken', 'That email address is already registered.');
    }
    const customer = { id: randomUUID(), name, email, ...hashPassword(password) };
    customersByEmail.set(emailKey(email), customer);
    res.status(201).json({ id: customer.id, name, email });
  });

  app.post('/sessions', (req, res) => {
    const { email, password } = req.body ?? {};
    const customer = isNonEmptyString(email) ? customersByEmail.get(emailKey(email)) : undefined;
    const valid =
      customer &&
      (hasDefect('login-accepts-any-password') ||
        (isNonEmptyString(password) &&
          timingSafeEqual(customer.hash, hashPassword(password, customer.salt).hash)));
    if (!valid) throw new ApiError(401, 'invalid_credentials', 'Email or password is incorrect.');

    const token = randomUUID();
    sessions.set(token, customer.id);
    res.status(201).json({ token });
  });

  app.post('/orders', requireCustomer, (req, res) => {
    const { items, currency } = req.body ?? {};
    if (!['GBP', 'EUR'].includes(currency)) throw badRequest('currency must be GBP or EUR.');
    if (!Array.isArray(items) || items.length === 0) throw badRequest('items are required.');
    if (items.length > MAX_ITEMS_PER_ORDER) {
      throw badRequest(`an order can have at most ${MAX_ITEMS_PER_ORDER} items.`);
    }

    let totalMinor = 0;
    for (const item of items) {
      if (!hasDefect('null-item-crashes') && (item === null || typeof item !== 'object')) {
        throw badRequest('each item must be an object with a sku and a quantity.');
      }
      const { sku, quantity } = item;
      if (!Object.hasOwn(CATALOGUE, sku ?? '')) throw badRequest(`Unknown sku "${sku}".`);

      const quantityOk = hasDefect('quantity-not-validated')
        ? true
        : hasDefect('quantity-unbounded')
          ? Number.isInteger(quantity) && quantity > 0
          : isPositiveInteger(quantity) && quantity <= MAX_QUANTITY_PER_ITEM;
      if (!quantityOk) {
        throw badRequest(`quantity must be a whole number from 1 to ${MAX_QUANTITY_PER_ITEM}.`);
      }
      totalMinor += CATALOGUE[sku][currency] * quantity;
    }
    if (!Number.isSafeInteger(totalMinor) && !hasDefect('quantity-unbounded')) {
      throw badRequest('the order total is too large.');
    }

    const order = {
      id: randomUUID(),
      customerId: req.customerId,
      items,
      currency,
      totalMinor,
    };
    orders.set(order.id, order);
    const { customerId, ...visible } = order;
    res.status(201).json(visible);
  });

  app.post('/payments', requireCustomer, (req, res) => {
    const { orderId, paymentMethod } = req.body ?? {};
    if (!['pm_success', 'pm_declined'].includes(paymentMethod)) {
      throw badRequest('paymentMethod must be pm_success or pm_declined.');
    }
    const order = orders.get(orderId);
    const visible =
      order &&
      (order.customerId === req.customerId ||
        hasDefect('ownership-not-checked') ||
        hasDefect('order-ownership-not-checked'));
    if (!visible) throw new ApiError(404, 'not_found', 'Order not found.');

    res.status(201).json(publicPayment(paymentService.authorise(order, paymentMethod)));
  });

  app.get('/payments/:id', requireCustomer, loadOwnedPayment, (req, res) => {
    res.json(publicPayment(req.payment));
  });

  app.get('/payments/:id/history', requireCustomer, loadOwnedPayment, (req, res) => {
    res.json({ paymentId: req.payment.id, entries: req.payment.history });
  });

  app.post('/payments/:id/capture', requireCustomer, loadOwnedPayment, (req, res) => {
    res.status(202).json(publicPayment(paymentService.requestCapture(req.payment)));
  });

  app.post('/payments/:id/refunds', requireCustomer, loadOwnedPayment, (req, res) => {
    const { amountMinor } = req.body ?? {};
    if (!isPositiveInteger(amountMinor)) {
      throw badRequest('amountMinor must be a positive integer.');
    }
    res.status(202).json(paymentService.requestRefund(req.payment, amountMinor));
  });

  if (enableSimulator) {
    // Demo only. Stands in for a payment provider so that tests can decide
    // what happens next: a late, repeated, failed or missing notification.
    app.post('/simulator/payment-events', (req, res) => {
      const { eventId, type, paymentId, refundId, delayMs = 0 } = req.body ?? {};
      if (!isNonEmptyString(eventId)) throw badRequest('eventId is required.');
      if (!EVENT_TYPES.includes(type)) throw badRequest(`type must be one of ${EVENT_TYPES}.`);
      if (type.startsWith('refund.') && !isNonEmptyString(refundId)) {
        throw badRequest('refundId is required for refund events.');
      }
      if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > MAX_EVENT_DELAY_MS) {
        throw badRequest(`delayMs must be between 0 and ${MAX_EVENT_DELAY_MS}.`);
      }
      if (!paymentService.find(paymentId)) {
        throw new ApiError(404, 'not_found', 'Payment not found.');
      }

      const delivery = { deliveryId: randomUUID(), eventId, status: 'queued' };
      deliveries.set(delivery.deliveryId, delivery);
      setTimeout(() => {
        Object.assign(delivery, paymentService.applyEvent({ eventId, type, paymentId, refundId }));
      }, delayMs).unref();
      res.status(202).json(delivery);
    });

    app.get('/simulator/deliveries/:id', (req, res) => {
      const delivery = deliveries.get(req.params.id);
      if (!delivery) throw new ApiError(404, 'not_found', 'Delivery not found.');
      res.json(delivery);
    });
  }

  app.use((_req, _res, next) => next(new ApiError(404, 'not_found', 'Route not found.')));

  app.use((err, _req, res, _next) => {
    if (err instanceof ApiError) {
      return res
        .status(err.httpStatus)
        .json({ error: { code: err.code, message: err.message } });
    }
    if (err.type === 'entity.parse.failed') {
      return res
        .status(400)
        .json({ error: { code: 'invalid_json', message: 'The request body is not valid JSON.' } });
    }
    console.error(err);
    return res
      .status(500)
      .json({ error: { code: 'internal_error', message: 'Something went wrong.' } });
  });

  return app;
}

module.exports = { createApp };
