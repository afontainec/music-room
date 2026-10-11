import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ByteRange, Storage, StoredObject } from './storage.js';

export class LocalDiskStorage implements Storage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    const root = path.resolve(this.root);
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error(`Invalid storage key: ${key}`);
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, data);
  }

  async open(key: string, range?: ByteRange): Promise<StoredObject | null> {
    const full = this.resolve(key);
    try {
      const { size } = await stat(full);
      return { size, stream: createReadStream(full, range) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}
