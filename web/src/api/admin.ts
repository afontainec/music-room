import { authHeaders, clearToken } from './auth';
import { NotFoundError, type RoomFile } from './rooms';

/** A room's track as the staff list shows it: its display name and a playable URL. */
export interface Track extends RoomFile {
  name: string;
  url: string;
}

/** The staff token was missing, expired or rejected; staff need to log in again. */
export class SessionExpiredError extends Error {}

const roomPath = (roomId: string) => `/api/rooms/${encodeURIComponent(roomId)}`;

async function check(res: Response, what: string): Promise<Response> {
  if (res.status === 401) {
    clearToken();
    throw new SessionExpiredError();
  }
  if (res.status === 404) throw new NotFoundError(what);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${what} failed with ${res.status}`);
  }
  return res;
}

/** Every track of the room, oldest first. */
export async function listTracks(roomId: string): Promise<Track[]> {
  const url = `${roomPath(roomId)}/files`;
  return (await check(await fetch(url), `GET ${url}`)).json() as Promise<Track[]>;
}

/** Uploads an mp3 to the room. Rejects with the server's message when the file is not accepted. */
export async function uploadTrack(roomId: string, file: File): Promise<void> {
  const body = new FormData();
  body.append('file', file);
  const url = `${roomPath(roomId)}/files`;
  await check(await fetch(url, { method: 'POST', headers: authHeaders(), body }), `POST ${url}`);
}

export async function removeTrack(id: string): Promise<void> {
  const url = `/api/files/${encodeURIComponent(id)}`;
  await check(await fetch(url, { method: 'DELETE', headers: authHeaders() }), `DELETE ${url}`);
}
