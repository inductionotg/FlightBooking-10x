// Development-only bootstrap for this checkout; never point at an existing database.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const services = [
  ['Auth_Service', 'baseline_auth', 3001],
  ['FlightandSearchService', 'baseline_flights', 3002],
  ['Booking_Service', 'baseline_booking', 3003],
  ['ReminderService', 'baseline_notifications', 3004],
];
function createOnly(file, content) {
  if (fs.existsSync(file)) throw new Error(`Refusing to overwrite ${file}`);
  fs.writeFileSync(file, content);
}
async function main() {
  // Check every destination before writing any configuration.
  const destinations = services.flatMap(([dir]) => [
    path.join(root, dir, '.env'), path.join(root, dir, 'src/config/config.json')
  ]).concat([
    path.join(root, 'AIRLINE-MANAGEMENT_API_GATEWAY/.env'),
    path.join(root, 'ReminderService/src/config/serverConfig.js')
  ]);
  for (const file of destinations) {
    if (fs.existsSync(file)) throw new Error(`Existing configuration: ${file}. Review manually; no files overwritten.`);
  }
  const mysql = require(path.join(root, 'FlightandSearchService/node_modules/mysql2/promise'));
  const connection = await mysql.createConnection({host:'127.0.0.1', port:33306, user:'root', password:'baseline-local-only'});
  const reservationKey = crypto.randomBytes(32).toString('hex');
  const observabilityKey = crypto.randomBytes(32).toString('hex');
  try {
    const [rows] = await connection.query('SHOW DATABASES');
    for (const [, database] of services) {
      if (rows.some(row => row.Database === database)) throw new Error(`Database ${database} already exists; refusing to reuse it during initial bootstrap.`);
    }
    for (const [dir, database, port] of services) {
      await connection.query(`CREATE DATABASE \`${database}\``);
      createOnly(path.join(root, dir, 'src/config/config.json'), JSON.stringify({development:{
        username:'root', password:'baseline-local-only', database,
        host:'127.0.0.1', port:33306, dialect:'mysql'
      }}, null, 2) + '\n');
      let env = `PORT=${port}\nOBSERVABILITY_KEY=${observabilityKey}\n`;
      if (dir === 'Auth_Service') env += `AUTH_KEY=${crypto.randomBytes(32).toString('hex')}\n`;
      if (dir === 'Booking_Service') env += 'FLIGHT_SERVICE_PATH=http://[::1]:3002\n';
      if (dir === 'FlightandSearchService') env += 'REDIS_URL=redis://127.0.0.1:36379\n';
      if (['Booking_Service', 'FlightandSearchService'].includes(dir)) env += `RESERVATION_SERVICE_KEY=${reservationKey}\n`;
      createOnly(path.join(root, dir, '.env'), env);
    }
    createOnly(path.join(root, 'AIRLINE-MANAGEMENT_API_GATEWAY/.env'), `PORT=3010\nOBSERVABILITY_KEY=${observabilityKey}\n`);
    createOnly(path.join(root, 'ReminderService/src/config/serverConfig.js'),
      "require('dotenv').config();\nmodule.exports = { PORT: process.env.PORT, EMAIL_ID: process.env.EMAIL_ID, EMAIL_PASS: process.env.EMAIL_PASS };\n");
    // Apply the service's migration history to its newly created schema.
    for (const [dir] of services) {
      execFileSync(process.execPath, [
        path.join(root, dir, 'node_modules/sequelize-cli/lib/sequelize'), 'db:migrate',
        '--config', path.join(root, dir, 'src/config/config.json'),
        '--migrations-path', path.join(root, dir, 'src/migrations'),
        '--env', 'development'
      ], {cwd:path.join(root, dir), stdio:'inherit'});
    }
    console.log('Created isolated local schemas and ignored configuration files.');
  } finally { await connection.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
