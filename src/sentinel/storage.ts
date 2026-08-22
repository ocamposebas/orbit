import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getServerEnv } from "./config";

export interface EvidenceStorage {
  put(key: string, contents: Uint8Array): Promise<string>;
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
}

export function evidenceStorage(): EvidenceStorage { return new LocalEvidenceStorage(); }
