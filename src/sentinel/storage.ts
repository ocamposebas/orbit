import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getServerEnv } from "./config";

export interface EvidenceStorage {
  put(key: string, contents: Uint8Array): Promise<string>;
  get(key: string): Promise<Uint8Array | undefined>;
}

export class LocalEvidenceStorage implements EvidenceStorage {
  private readonly root = path.resolve(getServerEnv().SCREENSHOT_STORAGE);
  async put(key: string, contents: Uint8Array) {
    const output = path.resolve(this.root, key);
    if (!output.startsWith(`${this.root}${path.sep}`)) throw new Error("Unsafe evidence storage path");
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, contents);
    return key;
  }
  async get(key: string) {
    const input = path.resolve(this.root, key);
    if (!input.startsWith(`${this.root}${path.sep}`)) throw new Error("Unsafe evidence storage path");
    try { return new Uint8Array(await readFile(input)); } catch { return undefined; }
  }
}

export function evidenceStorage(): EvidenceStorage { return new LocalEvidenceStorage(); }
