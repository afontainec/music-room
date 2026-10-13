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

export const listRooms = () => getJson<Room[]>('/api/rooms');

export const getRoom = (id: string) => getJson<RoomDetails>(`/api/rooms/${encodeURIComponent(id)}`);

/** A random track of the room, never `after` (the one that just played) unless it is the only one. */
export const getNextTrack = (roomId: string, after?: string | null) =>
  getJson<{ track: RoomFile | null }>(
    `/api/rooms/${encodeURIComponent(roomId)}/next-track${after ? `?after=${encodeURIComponent(after)}` : ''}`,
  ).then((res) => res.track);

/** Uploads are streamed by the server; URL tracks redirect to their source. */
export const trackUrl = (file: RoomFile) => `/api/files/${encodeURIComponent(file.id)}`;

export const trackTitle = (file: RoomFile) => file.originalName ?? file.fileRef;
