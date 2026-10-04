// Prints a one-time pairing code for a new device. Run on the server itself:
//   npm run pair                 (or: npm run pair -- "Kitchen tablet")
// The code is valid for 15 minutes and works once. Only its hash is written,
// to pairing-codes.json beside the data file, where the running server finds it.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CODE_TTL_MS, formatCode, newPairingCode, readCodeFile, sha256, writeCodeFile } from './devices.js';

if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

const name = process.argv.slice(2).join(' ').trim().slice(0, 40) || 'Device';
const file = resolve(dirname(resolve(process.env.DATA_FILE ?? './data/family.json')), 'pairing-codes.json');
const code = newPairingCode();
writeCodeFile(file, [...readCodeFile(file), { hash: sha256(code), name, expiresAt: Date.now() + CODE_TTL_MS }]);
console.log(`Pairing code for "${name}": ${formatCode(code)}`);
console.log('Open the family calendar on that device and enter it within 15 minutes.');
