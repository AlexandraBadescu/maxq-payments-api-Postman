'use strict';

// Run scenarios individually to catch accidental dependencies
// on data created by previous tests.
const { runSuite, listScenarios } = require('./lib/runSuite');

async function main() {
  let failed = 0;
  for (const scenario of listScenarios()) {
    const summary = await runSuite({ folder: scenario });
    const failures = summary.run.failures.length;
    const assertions = summary.run.stats.assertions.total;
    console.log(`${failures === 0 ? 'PASS' : 'FAIL'}  ${scenario} (${assertions} checks)`);
    if (failures > 0 || assertions === 0) failed += 1;
  }
  console.log(`\n${failed === 0 ? 'All scenarios pass on their own.' : `${failed} failed.`}`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
