import { authHeaders } from './auth';

export interface Room {
  id: string;
  name: string;
  createdAt: string;
}

export interface RoomFile {
  id: string;
  roomId: string;
  source: 'upload' | 'url';
  fileRef: string;
  originalName: string | null;
  createdAt: string;
}

export interface RoomDetails extends Room {
  files: RoomFile[];
}

export class NotFoundError extends Error {}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (res.status === 404) throw new NotFoundError(url);
  if (!res.ok) throw new Error(`GET ${url} failed with ${res.status}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 404) throw new NotFoundError(url);
  if (!res.ok) throw new Error(`POST ${url} failed with ${res.status}`);
  return res.json() as Promise<T>;
}

/** The room list is staff only: visitors without a staff token get a 401. */
export class StaffOnlyError extends Error {}

/** Every room, ordered by name. Sends the staff token when there is one. */
export async function listRooms(): Promise<Room[]> {
  const res = await fetch('/api/rooms', { headers: authHeaders() });
  if (res.status === 401) throw new StaffOnlyError('GET /api/rooms');
  if (!res.ok) throw new Error(`GET /api/rooms failed with ${res.status}`);
  return res.json() as Promise<Room[]>;
}

export const getRoom = (id: string) => getJson<RoomDetails>(`/api/rooms/${encodeURIComponent(id)}`);

/** A track as the server hands it to a device: its display name and a playable URL (uploads are
 * streamed by the server, URL tracks redirect to their source). */
export interface Layer {
  id: string;
  name: string;
  url: string;
}

const roomPath = (roomId: string) => `/api/rooms/${encodeURIComponent(roomId)}`;

/** The layer this device should play next: the room's least-used track, never `previousTrackId`
 * unless it is the only one. Null for a room without tracks. Also counts as a heartbeat. */
export const requestLayer = (roomId: string, deviceId: string, previousTrackId: string | null) =>
  postJson<{ track: Layer | null }>(`${roomPath(roomId)}/layer`, { deviceId, previousTrackId }).then(
    (res) => res.track,
  );

/** Keeps the device present in the room, playing `trackId`. Resolves with the room's current id and
 * name, so a rename reaches the open page; rejects with `NotFoundError` once the room is deleted. */
export const sendHeartbeat = (roomId: string, deviceId: string, trackId: string | null) =>
  postJson<{ room: Pick<Room, 'id' | 'name'> }>(`${roomPath(roomId)}/presence/heartbeat`, { deviceId, trackId }).then(
    (res) => res.room,
  );

/** Frees the device's layer right away. `keepalive` lets the request outlive a closing page;
 * failures are ignored, since the server drops the device 30 s after its last heartbeat anyway. */
export function releaseLayer(roomId: string, deviceId: string) {
  fetch(`${roomPath(roomId)}/presence/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
    keepalive: true,
  }).catch(() => {});
}
