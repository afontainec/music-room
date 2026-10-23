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

/** Every room, ordered by name. The list is staff only. */
export async function listAllRooms(): Promise<Room[]> {
  return (await check(await fetch('/api/rooms', { headers: authHeaders() }), 'GET /api/rooms')).json() as Promise<Room[]>;
}

/** Creates a room, in `colour` when given (else the server picks its default). Rejects with the
 * server's message for an empty, too long or duplicate name or a colour outside the palette. */
export async function createRoom(name: string, colour?: string): Promise<Room> {
  return (await sendJson('POST', '/api/rooms', { name, colour })).json() as Promise<Room>;
}

/** Renames a room. Rejects with the server's message for an empty, too long or duplicate name. */
export async function renameRoom(id: string, name: string): Promise<Room> {
  return (await sendJson('PATCH', roomPath(id), { name })).json() as Promise<Room>;
}

/** Changes a room's colour, keeping its name. Rejects with the server's message for a colour outside the palette. */
export async function setRoomColour(id: string, colour: string): Promise<Room> {
  return (await sendJson('PATCH', roomPath(id), { colour })).json() as Promise<Room>;
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

/** Adds an externally hosted mp3 to the room by its URL. Rejects with the server's message when the URL is not accepted. */
export async function addTrackByUrl(roomId: string, url: string): Promise<void> {
  await sendJson('POST', `${roomPath(roomId)}/files/url`, { url });
}

/** A room's usage in a date range, as `GET /api/analytics/rooms` reports it. */
export interface RoomUsage {
  id: string;
  name: string;
  colour: string;
  visits: number;
  visitors: number;
  plays: number;
}

/** Visits and plays per room, every room included. `from` and `to` are UTC dates (YYYY-MM-DD),
 * both days included; an omitted bound leaves that end of the range open. */
export async function roomUsage(range: { from?: string; to?: string }): Promise<RoomUsage[]> {
  const params = new URLSearchParams();
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);
  const url = `/api/analytics/rooms?${params}`;
  const res = await check(await fetch(url, { headers: authHeaders() }), 'GET /api/analytics/rooms');
  return ((await res.json()) as { rooms: RoomUsage[] }).rooms;
}

export async function removeTrack(id: string): Promise<void> {
  const url = `/api/files/${encodeURIComponent(id)}`;
  await check(await fetch(url, { method: 'DELETE', headers: authHeaders() }), `DELETE ${url}`);
}
