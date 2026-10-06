const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const authBase = (process.env.AUTH_API_URL || 'http://[::1]:3001/api/v1').replace(/\/$/, '');

async function signIn(email, password) {
  const response = await fetch(`${authBase}/signIn`, {
    method:'POST', headers:{'content-type':'application/json'},
    body:JSON.stringify({email, password}), signal:AbortSignal.timeout(10000)
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new Error(`Sign-in failed: ${result.message || response.status}`);
  return result.data;
}
async function adminToken() {
  const file = path.join(root, '.local', 'admin-credentials.json');
  if (!fs.existsSync(file)) throw new Error(`Run node scripts/create-local-admin.js first (${file}).`);
  const {email, password} = JSON.parse(fs.readFileSync(file, 'utf8'));
  return signIn(email, password);
}
async function adminIdentity() {
  const token = await adminToken();
  const response = await fetch(`${authBase}/me`, {headers:{'x-access-token':token}, signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error('Admin identity lookup failed');
  return {...(await response.json()).data, token};
}
module.exports = {signIn, adminToken, adminIdentity};
