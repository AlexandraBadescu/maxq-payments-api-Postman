'use strict';

const { createApp } = require('./app');

const port = Number(process.env.PORT ?? 4010);
// Local only by default. The simulator is a set of unauthenticated routes that can
// change any payment, so it is off unless you ask for it: ENABLE_SIMULATOR=true or --simulator.
const host = process.env.HOST ?? '127.0.0.1';
const enableSimulator = process.env.ENABLE_SIMULATOR === 'true' || process.argv.includes('--simulator');

const app = createApp({
  captureTimeoutMs: Number(process.env.CAPTURE_TIMEOUT_MS ?? 2000),
  enableSimulator,
  seededDefect: process.env.SEEDED_DEFECT,
});

app.listen(port, host, () => {
  console.log(
    `MaxQ demo API listening on http://${host}:${port} (simulator ${enableSimulator ? 'on' : 'off'})`,
  );
});
