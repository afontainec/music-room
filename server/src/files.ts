import path from 'node:path';

export class ValidationError extends Error {}

const MP3_MIME_TYPES = new Set(['audio/mpeg', 'audio/mp3']);

/** An mp3 starts with an ID3v2 tag or directly with an MPEG audio frame sync (11 set bits). */
function looksLikeMp3(data: Buffer): boolean {
  if (data.length >= 3 && data.toString('latin1', 0, 3) === 'ID3') return true;
  return data.length >= 2 && data[0] === 0xff && (data[1]! & 0xe0) === 0xe0;
}

export function validateMp3Upload(file: { filename: string; mimeType: string; data: Buffer }, maxBytes: number): void {
  if (file.data.length === 0) throw new ValidationError('File is empty');
  if (file.data.length > maxBytes) throw new ValidationError(`File exceeds the ${maxBytes} byte limit`);
  if (path.extname(file.filename).toLowerCase() !== '.mp3') throw new ValidationError('File must have a .mp3 extension');
  if (!MP3_MIME_TYPES.has(file.mimeType.toLowerCase())) throw new ValidationError('File must be audio/mpeg');
  if (!looksLikeMp3(file.data)) throw new ValidationError('File content is not an mp3');
}

/** External tracks are referenced, not re-hosted, so only the URL itself can be checked. */
export function validateMp3Url(raw: unknown): string {
  if (typeof raw !== 'string') throw new ValidationError('url is required');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('url is not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new ValidationError('url must be http or https');
  if (!url.pathname.toLowerCase().endsWith('.mp3')) throw new ValidationError('url must point to an .mp3 file');
  return url.toString();
}
