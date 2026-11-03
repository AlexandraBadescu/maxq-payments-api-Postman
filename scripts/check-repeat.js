'use strict';

// Runs the whole suite several times in a row, alternating GBP and EUR, and fails on the
// first run with a failed check. A suite that passes once can still be flaky.
// Usage: npm run test:repeat            (10 runs)
//        npm run test:repeat -- --runs 25
const { runSuite } = require('./lib/runSuite');

async function main() {
  const flag = process.argv.indexOf('--runs');
  const runs = flag === -1 ? 10 : Number(process.argv[flag + 1]);
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a whole number of 1 or more');

  let failedRuns = 0;
  for (let run = 1; run <= runs; run += 1) {
    const env = run % 2 === 1 ? 'local-gbp' : 'local-eur';
    const summary = await runSuite({ env });
    const failures = summary.run.failures.length;
    const checks = summary.run.stats.assertions.total;
    const ok = failures === 0 && checks > 0;
    if (!ok) failedRuns += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  run ${run}/${runs} (${env}): ${checks} checks, ${failures} failed`);
  }

  console.log(`\n${runs - failedRuns} of ${runs} runs passed.`);
  process.exitCode = failedRuns === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
