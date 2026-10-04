// Upgrade only the known local schemas created with model sync in step 1.
// This does not pretend that their old migration history has been reconciled.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const targets = [
  ['FlightandSearchService', 'baseline_flights', '20260929130000-create-reservations.js'],
  ['Booking_Service', 'baseline_booking', '20260929131000-add-booking-recovery.js']
];
async function main() {
  const dotenv = require(path.join(root, 'Booking_Service/node_modules/dotenv'));
  const envs = targets.map(([dir]) => ({file:path.join(root,dir,'.env'), text:fs.readFileSync(path.join(root,dir,'.env'),'utf8')}));
  const keys = envs.map(env => dotenv.parse(env.text).RESERVATION_SERVICE_KEY).filter(Boolean);
  assert.ok(keys.every(key => key === keys[0]), 'Existing reservation service keys do not match');
  const key = keys[0] || crypto.randomBytes(32).toString('hex');
  for (const [dir, name, migration] of targets) {
    const config = require(path.join(root,dir,'src/config/config.json')).development;
    assert.equal(config.database,name);assert.equal(config.host,'127.0.0.1');assert.equal(config.port,33306);
    const Sequelize = require(path.join(root,dir,'node_modules/sequelize'));
    const db = new Sequelize(config.database,config.username,config.password,{...config,logging:false});
    try {
      await db.query('CREATE TABLE IF NOT EXISTS LocalSchemaChanges (name VARCHAR(255) PRIMARY KEY, appliedAt DATETIME NOT NULL)');
      const [rows] = await db.query('SELECT name FROM LocalSchemaChanges WHERE name = ?', {replacements:[migration]});
      if (rows.length) { console.log(`${dir}: already applied`); continue; }
      await require(path.join(root,dir,'src/migrations',migration)).up(db.getQueryInterface(), Sequelize);
      await db.query('INSERT INTO LocalSchemaChanges (name, appliedAt) VALUES (?, NOW())', {replacements:[migration]});
      console.log(`${dir}: applied ${migration}`);
    } finally { await db.close(); }
  }
  for (const env of envs) {
    if (!dotenv.parse(env.text).RESERVATION_SERVICE_KEY) fs.appendFileSync(env.file, `\nRESERVATION_SERVICE_KEY=${key}\n`);
  }
  console.log('Local service key configured; existing booking and flight rows preserved. Restart flight and booking services.');
}
main().catch(error => {console.error(error.message);process.exitCode=1;});
