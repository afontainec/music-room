import { authHeaders, clearToken } from './auth';
import { NotFoundError, type Room, type RoomFile } from './rooms';

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

async function sendJson(method: 'POST' | 'PATCH', url: string, body: unknown): Promise<Response> {
  const headers = { ...authHeaders(), 'content-type': 'application/json' };
  return check(await fetch(url, { method, headers, body: JSON.stringify(body) }), `${method} ${url}`);
}

/** Creates a room. Rejects with the server's message for an empty, too long or duplicate name. */
export async function createRoom(name: string): Promise<Room> {
  return (await sendJson('POST', '/api/rooms', { name })).json() as Promise<Room>;
}

/** Renames a room. Rejects with the server's message for an empty, too long or duplicate name. */
export async function renameRoom(id: string, name: string): Promise<Room> {
  return (await sendJson('PATCH', roomPath(id), { name })).json() as Promise<Room>;
}

/** Deletes a room with all its tracks. */
export async function deleteRoom(id: string): Promise<void> {
  const url = roomPath(id);
  await check(await fetch(url, { method: 'DELETE', headers: authHeaders() }), `DELETE ${url}`);
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
