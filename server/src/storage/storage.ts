import type { Readable } from 'node:stream';

export interface ByteRange {
  start: number;
  /** Inclusive. */
  end: number;
}

export interface StoredObject {
  stream: Readable;
  /** Total size of the object, not of the requested range. */
  size: number;
}

/** The only way callers touch stored files, so local disk can be swapped for S3. */
export interface Storage {
  put(key: string, data: Buffer): Promise<void>;
  /** Returns null when the key does not exist. */
  open(key: string, range?: ByteRange): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}
