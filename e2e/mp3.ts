// A real, decodable mp3 of silence: MPEG-1 Layer III frames (128 kbps, 44.1 kHz, mono) whose
// side info and main data are all zero. Each 417-byte frame holds 1152 samples, about 26 ms.
const FRAME_BYTES = 417;
const FRAME_SECONDS = 1152 / 44100;

export function silentMp3(seconds = 10): Buffer {
  const frames = Math.ceil(seconds / FRAME_SECONDS);
  const data = Buffer.alloc(frames * FRAME_BYTES);
  for (let i = 0; i < frames; i++) data.set([0xff, 0xfb, 0x90, 0xc0], i * FRAME_BYTES);
  return data;
}
