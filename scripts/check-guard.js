'use strict';

// Checks the safety guard itself: pointed at a host that is not on its list,
// the collection must fail and must not send a single request there.
const path = require('node:path');
const newman = require('newman');
const { createApp } = require('../src/app');
const { ROOT } = require('./lib/runSuite');

async function main() {
  let requestsReceived = 0;
  const app = createApp({ enableSimulator: true });
  const http = require('node:http');
  const server = http.createServer((req, res) => {
    requestsReceived += 1;
    app(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  // The temporary service listens on loopback only. "127.1" is another spelling of
  // 127.0.0.1 that every platform resolves, but it is not on the collection's list.
  // (127.0.0.2 would also work on Linux, but macOS has no such loopback address by default.)
  const summary = await new Promise((resolve, reject) => {
    newman.run(
      {
        collection: path.join(ROOT, 'collections', 'payments.postman_collection.json'),
        environment: path.join(ROOT, 'environments', 'local-gbp.postman_environment.json'),
        envVar: [{ key: 'baseUrl', value: `http://127.1:${server.address().port}` }],
      },
      (error, result) => (error ? reject(error) : resolve(result)),
    );
  });
  server.closeAllConnections();
  server.close();

  const failures = summary.run.failures.length;
  const passed = requestsReceived === 0 && failures > 0;
  console.log(`Requests that reached the service: ${requestsReceived}`);
  console.log(`Failures reported: ${failures}`);
  console.log(passed ? 'PASS  The guard blocked the run.' : 'FAIL  The guard did not do its job.');
  process.exitCode = passed ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
