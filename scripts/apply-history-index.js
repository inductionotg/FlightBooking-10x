// Additive upgrade for the original local model-sync schema; fresh setups use migrations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const service = path.join(root, 'Booking_Service');
const config = require(path.join(service, 'src/config/config.json')).development;
const Sequelize = require(path.join(service, 'node_modules/sequelize'));
const migration = '20261006010000-add-booking-history-index.js';
async function main() {
  assert.equal(config.host,'127.0.0.1'); assert.equal(Number(config.port),33306); assert.equal(config.database,'baseline_booking');
  const db = new Sequelize(config.database,config.username,config.password,{...config,logging:false});
  try {
    const [[sample]] = await db.query('SELECT userId FROM Bookings GROUP BY userId ORDER BY COUNT(*) DESC LIMIT 1');
    const sql = 'EXPLAIN SELECT * FROM Bookings WHERE userId=? ORDER BY id DESC LIMIT 21';
    const options = {replacements:[sample?.userId || 1]};
    const [before] = await db.query(sql,options);
    const existing = (await db.getQueryInterface().showIndex('Bookings')).find(index=>index.name==='bookings_user_id_history');
    if (existing) assert.deepEqual(existing.fields.map(field=>field.attribute),['userId','id']);
    else await require(path.join(service,'src/migrations',migration)).up(db.getQueryInterface());
    await db.query('CREATE TABLE IF NOT EXISTS LocalSchemaChanges (name VARCHAR(255) PRIMARY KEY, appliedAt DATETIME NOT NULL)');
    await db.query('INSERT IGNORE INTO LocalSchemaChanges (name, appliedAt) VALUES (?, NOW())',{replacements:[migration]});
    const [after] = await db.query(sql,options);
    const report = {timestamp:new Date().toISOString(),before,after};
    if (!existing) fs.writeFileSync(path.join(root,'docs/history-index-plan.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  } finally { await db.close(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
