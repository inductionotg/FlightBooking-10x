// Apply only this additive migration to the existing local model-sync schema.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const service = path.join(root, 'FlightandSearchService');
const config = require(path.join(service, 'src/config/config.json')).development;
const Sequelize = require(path.join(service, 'node_modules/sequelize'));
const migration = '20260930140000-add-flight-search-index.js';
const index = 'flights_route_price_idx';
async function main() {
  assert.equal(config.database, 'baseline_flights');
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 33306);
  const db = new Sequelize(config.database, config.username, config.password, {...config, logging:false});
  try {
    const route = JSON.parse(fs.readFileSync(path.join(root, '.local/k6-catalog.json'))).routes[0];
    const sql = 'SELECT * FROM Flights WHERE departureAirportId=? AND arrivalAirportId=? AND price>=2000 AND price<=10000';
    const options = {replacements:[route.departureAirportId, route.arrivalAirportId]};
    const report = {timestamp:new Date().toISOString(), migration, route};
    [report.beforePlan] = await db.query(`EXPLAIN ${sql}`, options);
    [report.beforeAnalyze] = await db.query(`EXPLAIN ANALYZE ${sql}`, options);
    const [before] = await db.query(sql, options);
    await db.query('CREATE TABLE IF NOT EXISTS LocalSchemaChanges (name VARCHAR(255) PRIMARY KEY, appliedAt DATETIME NOT NULL)');
    const indexes = await db.getQueryInterface().showIndex('Flights');
    const existing = indexes.find(value => value.name === index);
    if (existing) {
      assert.deepEqual(existing.fields.map(field=>field.attribute), ['departureAirportId','arrivalAirportId','price']);
    } else {
      // MySQL DDL auto-commits. A retry can validate an index created before marker insertion.
      await require(path.join(service, 'src/migrations', migration)).up(db.getQueryInterface());
    }
    await db.query('INSERT IGNORE INTO LocalSchemaChanges (name, appliedAt) VALUES (?, NOW())', {replacements:[migration]});
    await db.query('ANALYZE TABLE Flights');
    [report.afterPlan] = await db.query(`EXPLAIN ${sql}`, options);
    [report.afterAnalyze] = await db.query(`EXPLAIN ANALYZE ${sql}`, options);
    const [after] = await db.query(sql, options);
    const sorted = rows => rows.sort((a,b)=>a.id-b.id);
    assert.deepEqual(sorted(after), sorted(before), 'Index must preserve all matching flight data');
    assert.equal(report.afterPlan[0].key, index, 'Optimizer must use the new index');
    report.matchingRows = after.length;
    report.sameResults = true;
    const destination = path.join(root,'docs/search-index-plan-results.json');
    // Retain the original before/after evidence on repeat execution.
    if (!existing && !fs.existsSync(destination)) fs.writeFileSync(destination, JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  } finally { await db.close(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
