'use strict';

const path = require('node:path');
const newman = require('newman');
const { createApp } = require('../../src/app');

const ROOT = path.resolve(__dirname, '..', '..');
const COLLECTION = path.join(ROOT, 'collections', 'payments.postman_collection.json');

function environmentFile(name) {
  return path.join(ROOT, 'environments', `${name}.postman_environment.json`);
}

function listScenarios() {
  return require(COLLECTION).item.map((folder) => folder.name);
}

/** Starts a fresh service on a free port, runs the collection, then stops it. */
async function runSuite({ env = 'local-gbp', folder, seededDefect, reporters = [], reporter } = {}) {
  const app = createApp({ seededDefect, enableSimulator: true });
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', (error) =>
      error ? reject(error) : resolve(listening),
    );
  });

  try {
    return await new Promise((resolve, reject) => {
      newman.run(
        {
          collection: COLLECTION,
          environment: environmentFile(env),
          envVar: [{ key: 'baseUrl', value: `http://127.0.0.1:${server.address().port}` }],
          folder,
          // A hung service should fail a request, not stall the run.
          timeout: 120000,
          timeoutRequest: 10000,
          reporters,
          reporter,
        },
        (error, summary) => (error ? reject(error) : resolve(summary)),
      );
    });
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

/** Every failed check: the scenario, the request it ran in and the check's name. */
function failedChecks(summary) {
  return summary.run.failures.map((failure) => {
    const item = failure.source;
    return {
      scenario: item?.parent?.()?.name ?? 'unknown',
      request: item?.name ?? 'unknown',
      check: failure.error?.test ?? failure.error?.name ?? 'unknown',
    };
  });
}

module.exports = { ROOT, runSuite, listScenarios, failedChecks };
