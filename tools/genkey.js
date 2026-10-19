/**
 * AirStudio license key generator (operator tool)
 * Usage:  node tools/genkey.js [count]
 * Must use the same LICENSE_SECRET as the server.
 */
const crypto = require('crypto');
const LICENSE_SECRET = process.env.LICENSE_SECRET || 'airstudio-dev-secret-change-me';
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function keyChecksum(body) {
  const h = crypto.createHmac('sha256', LICENSE_SECRET).update(body).digest();
  let out = '';
  for (let i = 0; i < 4; i++) out += KEY_ALPHABET[h[i] % KEY_ALPHABET.length];
  return out;
}
function makeKey() {
  const grp = () => Array.from({ length: 4 }, () => KEY_ALPHABET[crypto.randomInt(KEY_ALPHABET.length)]).join('');
  const body = `AIRS-${grp()}-${grp()}`;
  return `${body}-${keyChecksum(body)}`;
}

const n = Math.max(1, Math.min(100, parseInt(process.argv[2] || '1', 10)));
for (let i = 0; i < n; i++) console.log(makeKey());
