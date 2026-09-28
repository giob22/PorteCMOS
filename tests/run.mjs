// Esecuzione dei test con Node: node tests/run.mjs
import { run } from './suite.js';

const results = run();
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : `\n    ${r.error}`}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} test superati`);
process.exit(failed ? 1 : 0);
