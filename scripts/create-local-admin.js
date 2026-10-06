// Local-only bootstrap: creates one admin identity and stores its generated secret in ignored .local/.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const credentialsFile = path.join(root, '.local', 'admin-credentials.json');
const authDir = process.env.AUTH_SERVICE_DIR || path.join(root, 'Auth_Service');

async function main() {
  if (fs.existsSync(credentialsFile)) {
    console.log(`Admin credentials already exist at ${credentialsFile}; no account was changed.`);
    return;
  }
  const config = require(path.join(authDir, 'src/config/config.json')).development;
  if (process.env.NODE_ENV && process.env.NODE_ENV !== 'development') throw new Error('Local admin bootstrap requires development mode');
  if (config.host !== '127.0.0.1' || Number(config.port) !== 33306 || config.database !== 'baseline_auth')
    throw new Error('Refusing to bootstrap an admin outside the dedicated local baseline_auth database');
  const db = require(path.join(authDir, 'src/models'));
  const email = `local-admin-${crypto.randomBytes(6).toString('hex')}@example.test`;
  const password = crypto.randomBytes(24).toString('base64url');
  try {
    await db.sequelize.transaction(async transaction => {
      const [role] = await db.Role.findOrCreate({where:{name:'ADMIN'}, defaults:{name:'ADMIN'}, transaction});
      const user = await db.User.create({email, password}, {transaction});
      await user.addRole(role, {transaction});
    });
    fs.mkdirSync(path.dirname(credentialsFile), {recursive:true});
    fs.writeFileSync(credentialsFile, JSON.stringify({email, password}, null, 2) + '\n', {flag:'wx', mode:0o600});
    console.log(`Created local admin. Credentials: ${credentialsFile} (ignored by Git).`);
  } finally { await db.sequelize.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
