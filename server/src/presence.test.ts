import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Presence } from './presence.js';

describe('presence', () => {
  let presence: Presence;

  beforeEach(() => {
    vi.useFakeTimers();
    presence = new Presence({ ttlMs: 30_000, sweepMs: 5_000 });
  });

  afterEach(() => {
    presence.stop();
    vi.useRealTimers();
  });

  it('registers a device on its first heartbeat and refreshes it on the next', () => {
    presence.heartbeat('room', 'a', 't1');
    vi.advanceTimersByTime(10_000);
    presence.heartbeat('room', 'a', 't2');
    expect(presence.present('room')).toEqual([{ deviceId: 'a', trackId: 't2', lastSeen: Date.now() }]);
  });

  it('keeps rooms separate', () => {
    presence.heartbeat('one', 'a', null);
    presence.heartbeat('two', 'b', null);
    expect(presence.present('one').map((d) => d.deviceId)).toEqual(['a']);
    expect(presence.present('two').map((d) => d.deviceId)).toEqual(['b']);
  });

  it('drops a device 30 seconds after its last heartbeat', () => {
    presence.heartbeat('room', 'a', null);
    vi.advanceTimersByTime(20_000);
    presence.heartbeat('room', 'b', null);
    vi.advanceTimersByTime(9_999);
    expect(presence.present('room').map((d) => d.deviceId)).toEqual(['a', 'b']);
    vi.advanceTimersByTime(1);
    expect(presence.present('room').map((d) => d.deviceId)).toEqual(['b']);
  });

  it('frees expired devices from memory with the periodic sweep', () => {
    presence.start();
    vi.advanceTimersByTime(2_000);
    presence.heartbeat('room', 'a', null);
    // Expired at 32 s, but still held until the sweep at 35 s.
    vi.advanceTimersByTime(30_000);
    expect(presence.size()).toBe(1);
    vi.advanceTimersByTime(3_000);
    expect(presence.size()).toBe(0);
  });

  it('removes a device immediately on leave', () => {
    presence.heartbeat('room', 'a', null);
    expect(presence.leave('room', 'a')).toBe(true);
    expect(presence.present('room')).toEqual([]);
    expect(presence.leave('room', 'a')).toBe(false);
    expect(presence.leave('other', 'a')).toBe(false);
  });

  it('holds 100 devices in one room and keeps nothing once they are gone', () => {
    presence.start();
    for (let i = 0; i < 100; i++) presence.heartbeat('room', `d${i}`, null);
    expect(presence.present('room')).toHaveLength(100);
    // One shared sweep timer, not one per device.
    expect(vi.getTimerCount()).toBe(1);

    for (let i = 0; i < 50; i++) presence.leave('room', `d${i}`);
    expect(presence.size()).toBe(50);
    vi.advanceTimersByTime(35_000);
    expect(presence.size()).toBe(0);
    expect(vi.getTimerCount()).toBe(1);

    presence.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});
