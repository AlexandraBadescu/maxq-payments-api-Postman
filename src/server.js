'use strict';

const { createApp } = require('./app');

const port = Number(process.env.PORT ?? 4010);
const app = createApp({
  captureTimeoutMs: Number(process.env.CAPTURE_TIMEOUT_MS ?? 2000),
  enableSimulator: process.env.ENABLE_SIMULATOR !== 'false',
  seededDefect: process.env.SEEDED_DEFECT,
});

app.listen(port, () => {
  console.log(`MaxQ demo API listening on http://localhost:${port}`);
});
