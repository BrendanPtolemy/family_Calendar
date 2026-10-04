// Who may use the family display at all.
//
// Every phone, tablet or laptop is paired once with a short code and then holds
// a long-lived device cookie. The parent PIN is a second step on top of that
// ("parent mode"), not the front door. Codes come from two places:
//   - a parent on an already-paired device (Settings › Devices › Add a device)
//   - `npm run pair` on the server itself, which is how the very first device
//     gets in (shell access to the box is the root of trust).

import { createHash, randomBytes, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Request } from 'express';
import type { Device } from '../shared/types.js';
import { newId, type Store } from './store.js';

export const DEVICE_COOKIE = 'fc_device';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const CODE_LENGTH = 8;
export const CODE_TTL_MS = 15 * 60 * 1000;
const COOKIE_MAX_AGE_MS = 400 * 86_400_000; // browsers cap cookies at 400 days
const LAST_SEEN_EVERY_MS = 60 * 60 * 1000;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export function newPairingCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

/** Accepts "abcd-efgh", "ABCD EFGH" etc. */
export const normalizeCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
export const formatCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

interface PendingCode {
  hash: string;
  name: string;
  expiresAt: number;
}

/** Codes written by `npm run pair` live in a small file beside the data file. */
export function readCodeFile(file: string): PendingCode[] {
  if (!existsSync(file)) return [];
  try {
    const list = JSON.parse(readFileSync(file, 'utf8')) as PendingCode[];
    return Array.isArray(list) ? list.filter((c) => c.expiresAt > Date.now()) : [];
  } catch {
    return [];
  }
}

export function writeCodeFile(file: string, codes: PendingCode[]) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(codes, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export class DeviceAuth {
  private codes: PendingCode[] = [];

  constructor(
    private store: Store,
    private codeFile: string | null,
  ) {}

  /** Secure only when this request really came over HTTPS (directly or via a trusted proxy);
   *  a Secure cookie set over plain HTTP on the home LAN would just be dropped. */
  cookieOptions(req: Request) {
    return { httpOnly: true, sameSite: 'strict' as const, secure: req.secure, maxAge: COOKIE_MAX_AGE_MS, path: '/' };
  }

  /** A parent on a paired device asks for a code to let another device in. */
  createCode(name: string): { code: string; expiresAt: string } {
    const code = newPairingCode();
    const expiresAt = Date.now() + CODE_TTL_MS;
    this.codes = this.codes.filter((c) => c.expiresAt > Date.now());
    this.codes.push({ hash: sha256(code), name, expiresAt });
    return { code: formatCode(code), expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Single use: a matching code is consumed whether it came from memory or the file. */
  private consumeCode(raw: string): PendingCode | null {
    const hash = sha256(normalizeCode(raw));
    const now = Date.now();
    this.codes = this.codes.filter((c) => c.expiresAt > now);
    const mem = this.codes.find((c) => c.hash === hash);
    if (mem) {
      this.codes = this.codes.filter((c) => c !== mem);
      return mem;
    }
    if (!this.codeFile) return null;
    const fileCodes = readCodeFile(this.codeFile);
    const hit = fileCodes.find((c) => c.hash === hash);
    if (!hit) return null;
    writeCodeFile(this.codeFile, fileCodes.filter((c) => c !== hit));
    return hit;
  }

  /** Returns the new device and its secret token (only ever sent in the cookie). */
  pair(rawCode: string, requestedName: string): { device: Device; token: string } | null {
    const code = this.consumeCode(rawCode);
    if (!code) return null;
    const token = randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    const device: Device = { id: newId(), name: requestedName || code.name || 'Device', tokenHash: sha256(token), createdAt: now, lastSeenAt: now };
    this.store.update((d) => { d.devices.push(device); });
    return { device, token };
  }

  /** The paired device making this request, if any. */
  identify(req: Request): Device | undefined {
    const token = readCookie(req, DEVICE_COOKIE);
    if (!token) return undefined;
    const hash = sha256(token);
    const device = this.store.data.devices.find((d) => d.tokenHash === hash);
    if (device && Date.now() - Date.parse(device.lastSeenAt) > LAST_SEEN_EVERY_MS) {
      this.store.update(() => { device.lastSeenAt = new Date().toISOString(); });
    }
    return device;
  }

  remove(id: string): boolean {
    const before = this.store.data.devices.length;
    this.store.update((d) => { d.devices = d.devices.filter((x) => x.id !== id); });
    return this.store.data.devices.length < before;
  }
}
