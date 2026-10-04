// Integration checks run only on new, randomly named local MySQL schemas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const root = path.resolve(__dirname, '..');
const mysql = require(path.join(root, 'FlightandSearchService/node_modules/mysql2/promise'));
const settings = {host:'127.0.0.1', port:33306, user:'root', password:'baseline-local-only'};
const report = {timestamp:new Date().toISOString(), checks:[], schemasRemoved:[]};
const check = name => report.checks.push({name, passed:true});
const services = ['Auth_Service','Booking_Service','FlightandSearchService','ReminderService'];

async function main() {
  const admin = await mysql.createConnection(settings);
  try {
    for (const service of services) {
      const database = `migration_check_${crypto.randomBytes(8).toString('hex')}`;
      assert.match(database, /^migration_check_[a-f0-9]{16}$/);
      const configPath = path.join(root, '.local', `${database}.json`);
      fs.mkdirSync(path.dirname(configPath), {recursive:true});
      // No IF NOT EXISTS: a collision must fail, never reuse another database.
      await admin.query(`CREATE DATABASE \`${database}\``);
      let connection;
      try {
        fs.writeFileSync(configPath, JSON.stringify({development:{
          username:settings.user, password:settings.password, host:settings.host,
          port:settings.port, database, dialect:'mysql', logging:false
        }}));
        connection = await mysql.createConnection({...settings, database});
        async function migrate(command) {
          try {
            return await execFile(process.execPath, [
              path.join(root, service, 'node_modules/sequelize-cli/lib/sequelize'), command,
              '--config', configPath, '--migrations-path', path.join(root, service, 'src/migrations'),
              '--env', 'development'
            ], {cwd:path.join(root, service), timeout:60000});
          } catch (error) {
            throw new Error(`${service} ${command}: ${error.stderr || error.message}`);
          }
        }
        await migrate('db:migrate');
        const [history] = await connection.query('SELECT name FROM SequelizeMeta ORDER BY name');
        assert.deepEqual(history.map(row => row.name), fs.readdirSync(path.join(root, service, 'src/migrations')).filter(name=>name.endsWith('.js')).sort());
        check(`${service}: complete migration history on empty schema`);
        await migrate('db:migrate');
        check(`${service}: repeated migrate succeeds`);

        if (service === 'FlightandSearchService') {
          const name = 'flights_route_price_idx';
          const [indexes] = await connection.query('SHOW INDEX FROM Flights WHERE Key_name = ?', [name]);
          assert.deepEqual(indexes.map(row=>row.Column_name), ['departureAirportId','arrivalAirportId','price']);
          await connection.query("INSERT INTO Flights (flightNumber,airplaneId,departureAirportId,arrivalAirportId,arrivalTime,departureTime,price,totalSeats,createdAt,updatedAt) VALUES ('index-check',1,1,2,'2099-01-01 12:00:00','2099-01-01 10:00:00',2500,10,NOW(),NOW())");
          await migrate('db:migrate:undo');
          const [removed] = await connection.query('SHOW INDEX FROM Flights WHERE Key_name = ?', [name]);
          assert.equal(removed.length, 0);
          await migrate('db:migrate');
          const [[flight]] = await connection.query("SELECT price,totalSeats FROM Flights WHERE flightNumber='index-check'");
          assert.equal(flight.price, 2500); assert.equal(flight.totalSeats, 10);
          check('Flight: route/price index rollback and reapply preserve flight data');
        }

        if (service === 'Booking_Service') {
          // Undo outbox/contact metadata, recovery columns, then historical seat/cost migration.
          await migrate('db:migrate:undo');
          await migrate('db:migrate:undo');
          await migrate('db:migrate:undo');
          const [columns] = await connection.query('SHOW COLUMNS FROM Bookings');
          assert.ok(!columns.some(column => ['noOfSeats','totalCost'].includes(column.Field)));
          await connection.query('INSERT INTO Bookings (flightId,userId,createdAt,updatedAt) VALUES (1,1,NOW(),NOW())');
          await migrate('db:migrate');
          const [[booking]] = await connection.query('SELECT * FROM Bookings');
          assert.equal(booking.noOfSeats, 1);
          assert.equal(booking.totalCost, 0);
          assert.equal(booking.status, 'InProcess');
          check('Booking: column rollback/reapply preserves existing row and backfills defaults');
          const {Sequelize, DataTypes} = require(path.join(root, service, 'node_modules/sequelize'));
          const orm = new Sequelize(database, settings.user, settings.password, {...settings, dialect:'mysql', logging:false});
          try {
            const Booking = require(path.join(root, service, 'src/models/booking'))(orm, DataTypes);
            const row = await Booking.create({flightId:2,userId:2,noOfSeats:2,totalCost:5000});
            assert.equal((await Booking.findByPk(row.id)).totalCost, 5000);
            check('Booking: existing model reads/writes migrated schema');
          } finally { await orm.close(); }
        }

        if (service === 'Auth_Service') {
          const {Sequelize, DataTypes} = require(path.join(root, service, 'node_modules/sequelize'));
          const orm = new Sequelize(database, settings.user, settings.password, {...settings, dialect:'mysql', logging:false});
          try {
            const User = require(path.join(root, service, 'src/models/user'))(orm, DataTypes);
            const Role = require(path.join(root, service, 'src/models/role'))(orm, DataTypes);
            User.associate({User,Role});
            Role.associate({User,Role});
            const user = await User.create({email:'migration@example.test',password:'Local-migration-test!'});
            const role = await Role.create({name:'ADMIN'});
            await user.addRole(role);
            assert.equal(await user.hasRole(role), true);
            check('Auth: existing model role assignment and lookup work');
            await assert.rejects(connection.query('INSERT INTO User_Roles (UserId,RoleId,createdAt,updatedAt) VALUES (?,?,NOW(),NOW())',[user.id,role.id]), error => error.code === 'ER_DUP_ENTRY');
            await assert.rejects(connection.query('INSERT INTO User_Roles (UserId,RoleId,createdAt,updatedAt) VALUES (?,?,NOW(),NOW())',[user.id + 1000,role.id]), error => error.code === 'ER_NO_REFERENCED_ROW_2');
            await assert.rejects(connection.query('INSERT INTO User_Roles (UserId,RoleId,createdAt,updatedAt) VALUES (?,?,NOW(),NOW())',[user.id,role.id + 1000]), error => error.code === 'ER_NO_REFERENCED_ROW_2');
            check('Auth: duplicate assignments and missing user/role references rejected');
            await role.destroy();
            const [[roleCascade]] = await connection.query('SELECT COUNT(*) AS n FROM User_Roles');
            assert.equal(roleCascade.n, 0);
            const secondRole = await Role.create({name:'CUSTOMER'});
            await user.addRole(secondRole);
            await user.destroy();
            const [[userCascade]] = await connection.query('SELECT COUNT(*) AS n FROM User_Roles');
            assert.equal(userCascade.n, 0);
            check('Auth: deleting either parent removes its role assignments');
            await migrate('db:migrate:undo');
            assert.equal(await Role.count(), 1);
            await migrate('db:migrate');
            assert.equal(await Role.count(), 1);
            check('Auth: join-table rollback/reapply preserves parent records');
          } finally { await orm.close(); }
        }

        await migrate('db:migrate:undo:all');
        const [tables] = await connection.query('SHOW TABLES');
        assert.deepEqual(tables.map(row=>Object.values(row)[0]), ['SequelizeMeta']);
        await migrate('db:migrate');
        check(`${service}: full rollback and fresh reapplication succeed`);
      } finally {
        if (connection) await connection.end();
        await admin.query(`DROP DATABASE \`${database}\``);
        report.schemasRemoved.push(database);
        if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
      }
    }
  } finally { await admin.end(); }
}
main().then(() => {report.passed = true;}).catch(error => {
  report.passed = false;
  report.error = error.message;
  process.exitCode = 1;
}).finally(() => {
  fs.mkdirSync(path.join(root, 'docs'), {recursive:true});
  fs.writeFileSync(path.join(root, 'docs/migration-check-results.json'), JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
});
