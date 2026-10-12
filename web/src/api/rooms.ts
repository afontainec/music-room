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
