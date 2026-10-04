// Reduce a local V8 CPU profile to reviewable stack-sample counts.
// Raw profiles stay in .local; this output contains no request or credential data.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const run = process.argv[2];
if (!/^profile-200-[a-z0-9-]+$/.test(run || '')) {
  throw new Error('Usage: node scripts/summarize-flight-profile.cjs profile-200-...');
}
const input = path.join(root, '.local', 'profiles', `${run}.cpuprofile`);
const profile = JSON.parse(fs.readFileSync(input, 'utf8'));
const nodes = new Map(profile.nodes.map(node => [node.id, node]));
const parentIds = new Map();
for (const node of profile.nodes) {
  for (const childId of node.children || []) parentIds.set(childId, node.id);
}
const counts = {samples: 0, idle: 0, active: 0, logging: 0, synchronousLogWrite: 0,
  expressJson: 0, flightCache: 0, mysql2: 0, gc: 0};

for (const sampleId of profile.samples || []) {
  const frames = [];
  let node = nodes.get(sampleId);
  while (node) {
    frames.push(node.callFrame);
    node = nodes.get(parentIds.get(node.id));
  }
  counts.samples++;
  if (frames.some(frame => frame.functionName === '(idle)')) {
    counts.idle++;
    continue;
  }
  counts.active++;
  const has = predicate => frames.some(predicate);
  const logging = has(frame => frame.functionName === 'log' &&
    /[/\\]observability\.js$/.test(frame.url));
  if (logging) counts.logging++;
  if (logging && has(frame => frame.functionName === 'SyncWriteStream._write' &&
    frame.url.includes('internal/fs/sync_write_stream'))) counts.synchronousLogWrite++;
  if (has(frame => frame.functionName === 'stringify' &&
    frame.url.includes('express/lib/response'))) counts.expressJson++;
  if (has(frame => /[/\\]flight-cache\.js$/.test(frame.url))) counts.flightCache++;
  if (has(frame => /[/\\]mysql2[/\\]/.test(frame.url))) counts.mysql2++;
  if (has(frame => frame.functionName === '(garbage collector)')) counts.gc++;
}

const percent = count => Number((count * 100 / counts.active).toFixed(1));
const result = {
  run,
  profilingSeconds: Number(((profile.endTime - profile.startTime) / 1e6).toFixed(2)),
  samples: counts.samples,
  idleSamples: counts.idle,
  activeSamples: counts.active,
  activeStackSamples: {
    observabilityLog: {count: counts.logging, percent: percent(counts.logging)},
    synchronousLogWrite: {count: counts.synchronousLogWrite, percent: percent(counts.synchronousLogWrite)},
    expressJson: {count: counts.expressJson, percent: percent(counts.expressJson)},
    flightCache: {count: counts.flightCache, percent: percent(counts.flightCache)},
    mysql2: {count: counts.mysql2, percent: percent(counts.mysql2)},
    garbageCollector: {count: counts.gc, percent: percent(counts.gc)}
  },
  notes: 'Inclusive stack categories overlap. Percentages use non-idle samples as denominator and are not end-to-end latency shares.'
};
console.log(JSON.stringify(result, null, 2));
