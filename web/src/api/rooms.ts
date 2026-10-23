export interface Room {
  id: string;
  name: string;
  /** A colour from the room palette (docs/design/visual-style.md); the server derives one from the
   * id for rooms without a stored colour, so it is always set. */
  colour: string;
  createdAt: string;
}

/** A room in the public room list: only its public fields and the number of tracks (layers) it holds. */
export interface RoomSummary extends Pick<Room, 'id' | 'name' | 'colour'> {
  trackCount: number;
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

/** Every room, ordered by name. The list is public, so no staff token is needed. */
export const listRooms = () => getJson<RoomSummary[]>('/api/rooms');

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

/** Keeps the device present in the room, playing `trackId`. */
export const sendHeartbeat = (roomId: string, deviceId: string, trackId: string | null) =>
  postJson<unknown>(`${roomPath(roomId)}/presence/heartbeat`, { deviceId, trackId }).then(() => {});

// Analytics events are fire-and-forget: a lost event must never interrupt listening.
const recordEvent = (url: string, body: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});

/** Counts one visit to the room (the server sets the timestamp). */
export const recordVisit = (roomId: string, deviceId: string) => {
  recordEvent(`${roomPath(roomId)}/visits`, { deviceId });
};

/** Counts one play of a track in the room, sent when the track starts playing. */
export const recordPlay = (roomId: string, deviceId: string, trackId: string) => {
  recordEvent(`${roomPath(roomId)}/plays`, { deviceId, trackId });
};

/** Frees the device's layer right away. `keepalive` lets the request outlive a closing page;
 * failures are ignored, since the server drops the device 30 s after its last heartbeat anyway. */
export function releaseLayer(roomId: string, deviceId: string) {
  fetch(`${roomPath(roomId)}/presence/${encodeURIComponent(deviceId)}`, {
    method: 'DELETE',
    keepalive: true,
  }).catch(() => {});
}
