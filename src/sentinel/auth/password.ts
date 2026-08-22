import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";

const keyLength = 64;
const parameters = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scrypt(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => nodeScrypt(password, salt, keyLength, parameters, (error, key) => error ? reject(error) : resolve(key)));
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt);
  return `scrypt$v1$${parameters.N}$${parameters.r}$${parameters.p}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, version, n, r, p, salt, stored] = encoded.split("$");
  if (algorithm !== "scrypt" || version !== "v1" || !n || !r || !p || !salt || !stored) return false;
  const expected = Buffer.from(stored, "base64url");
  const actual = await new Promise<Buffer>((resolve, reject) => nodeScrypt(password, Buffer.from(salt, "base64url"), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
