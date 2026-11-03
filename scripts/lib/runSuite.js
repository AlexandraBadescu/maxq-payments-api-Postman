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

/** The scenario folders in which a run had at least one failed check. */
function failedScenarios(summary) {
  const scenarios = new Set();
  for (const failure of summary.run.failures) {
    const item = failure.item ?? failure.source;
    const parent = item?.parent?.();
    if (parent?.name) scenarios.add(parent.name);
  }
  return [...scenarios];
}

module.exports = { ROOT, runSuite, listScenarios, failedScenarios };
