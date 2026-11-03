'use strict';

// Usage: npm test            (GBP)
//        npm run test:eur    (EUR)
const path = require('node:path');
const { ROOT, runSuite } = require('./lib/runSuite');

async function main() {
  const flag = process.argv.indexOf('--env');
  const env = flag === -1 ? 'local-gbp' : process.argv[flag + 1];

  const summary = await runSuite({
    env,
    reporters: ['cli', 'junit'],
    reporter: {
      junit: { export: path.join(ROOT, 'reports', `payments-${env}.xml`) },
    },
  });

  // A run that checked nothing has not passed.
  const { total } = summary.run.stats.assertions;
  if (total === 0) console.error('No checks ran, so this run cannot count as a pass.');
  process.exitCode = summary.run.failures.length === 0 && total > 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
