// In-memory record of the devices currently listening in each room, kept alive by heartbeats.
// One instance per process: the app runs as a single replica (see CLAUDE.md), and losing this
// state on a restart is fine because every device re-registers with its next heartbeat.

export interface PresentDevice {
  deviceId: string;
  trackId: string | null;
  lastSeen: number;
}

export interface PresenceOptions {
  /** A device is no longer present this long after its last heartbeat. */
  ttlMs?: number;
  /** How often expired devices are evicted from memory. */
  sweepMs?: number;
  now?: () => number;
}

export const PRESENCE_TTL_MS = 30_000;

export class Presence {
  private readonly rooms = new Map<string, Map<string, PresentDevice>>();
  private readonly ttlMs: number;
  private readonly sweepMs: number;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | undefined;

  constructor(opts: PresenceOptions = {}) {
    this.ttlMs = opts.ttlMs ?? PRESENCE_TTL_MS;
    this.sweepMs = opts.sweepMs ?? 5_000;
    this.now = opts.now ?? Date.now;
  }

  /** Registers the device in the room, or refreshes it, with the track it is playing. */
  heartbeat(roomId: string, deviceId: string, trackId: string | null): PresentDevice {
    let devices = this.rooms.get(roomId);
    if (!devices) this.rooms.set(roomId, (devices = new Map()));
    const device = { deviceId, trackId, lastSeen: this.now() };
    devices.set(deviceId, device);
    return device;
  }

  /** Removes the device right away. False when it was not present. */
  leave(roomId: string, deviceId: string): boolean {
    const devices = this.rooms.get(roomId);
    if (!devices?.delete(deviceId)) return false;
    if (devices.size === 0) this.rooms.delete(roomId);
    return true;
  }

  /** Forgets every device in the room, e.g. when the room is deleted. */
  clearRoom(roomId: string): void {
    this.rooms.delete(roomId);
  }

  /** Devices heard from within the TTL. Expired ones are dropped here too, so a device
   * disappears exactly at the TTL rather than at the next sweep. */
  present(roomId: string): PresentDevice[] {
    this.evict(roomId);
    return [...(this.rooms.get(roomId)?.values() ?? [])];
  }

  /** Number of devices held in memory across all rooms, expired or not. */
  size(): number {
    let n = 0;
    for (const devices of this.rooms.values()) n += devices.size;
    return n;
  }

  sweep(): void {
    for (const roomId of [...this.rooms.keys()]) this.evict(roomId);
  }

  /** Starts the periodic sweep. One timer for the whole store, however many devices. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), this.sweepMs);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private evict(roomId: string): void {
    const devices = this.rooms.get(roomId);
    if (!devices) return;
    const cutoff = this.now() - this.ttlMs;
    for (const [id, device] of devices) {
      if (device.lastSeen <= cutoff) devices.delete(id);
    }
    if (devices.size === 0) this.rooms.delete(roomId);
  }
}
