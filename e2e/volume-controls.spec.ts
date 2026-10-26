import { expect, test, type Page } from '@playwright/test';
import { audio, blockAutoplay, createRoomWithTracks, enterRoom, expectPlaying, playingTrackId } from './room';

const muteButton = (page: Page) => page.getByRole('button', { name: 'Mute' });
const slider = (page: Page) => page.getByRole('slider', { name: 'Volume' });

const element = (page: Page) =>
  audio(page).evaluate((a: HTMLAudioElement) => ({
    volume: a.volume,
    muted: a.muted,
    paused: a.paused,
    time: a.currentTime,
    id: a.dataset.trackId!,
  }));

/** Waits until the layer's fade-in has brought the element to `level`. */
async function expectVolume(page: Page, level: number) {
  await expect
    .poll(async () => Math.round((await element(page)).volume * 100) / 100, { timeout: 8_000 })
    .toBe(level);
}

async function expectAdvancing(page: Page) {
  const before = (await element(page)).time;
  await expect.poll(async () => (await element(page)).time, { timeout: 5_000 }).toBeGreaterThan(before + 0.3);
}

test.describe('Visitor can mute/unmute audio', () => {
  test('the mute button silences the layer, which keeps playing, and a second press brings it back', async ({
    page,
    request,
  }) => {
    const room = await createRoomWithTracks(request, 2);
    await enterRoom(page, room.name);
    const track = await playingTrackId(page);
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'false');

    await muteButton(page).click();
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'true');
    expect((await element(page)).muted).toBe(true);
    await expectAdvancing(page);
    expect((await element(page)).paused, 'muting does not pause').toBe(false);

    await muteButton(page).click();
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'false');
    const after = await element(page);
    expect(after.muted).toBe(false);
    expect(after.id, 'unmuting continues the same layer').toBe(track);
    await expectAdvancing(page);
  });

  test('moving the slider while muted unmutes', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    await muteButton(page).click();
    await slider(page).fill('60');
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'false');
    expect((await element(page)).muted).toBe(false);
    await expectVolume(page, 0.6);
  });
});

test.describe('Visitor can adjust volume via a slider or similar control', () => {
  test('the slider sets the volume of the playing layer', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    await expect(slider(page)).toHaveValue('100');
    await expectVolume(page, 1);

    await slider(page).fill('40');
    await expectVolume(page, 0.4);
    await slider(page).fill('0');
    await expectVolume(page, 0);
    expect((await element(page)).paused, 'volume 0 does not pause').toBe(false);
  });

  test('arrow keys move the slider', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    await expectVolume(page, 1);
    await slider(page).focus();
    for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft');
    await expect(slider(page)).toHaveValue('90');
    await expectVolume(page, 0.9);
  });

  test('a lower level set during the fade-in caps the fade', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    await slider(page).fill('50');
    await expectVolume(page, 0.5);
    // The fade (3 s) is over by now and never went above the visitor's level.
    await page.waitForTimeout(3_500);
    expect((await element(page)).volume).toBeCloseTo(0.5, 2);
  });
});

test.describe('Settings persist only for the current session', () => {
  test('the next layer keeps the volume and mute', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2, 5);
    await enterRoom(page, room.name);
    const first = await playingTrackId(page);
    await slider(page).fill('30');
    await muteButton(page).click();

    await expect.poll(async () => (await element(page)).id, { timeout: 15_000 }).not.toBe(first);
    await expectPlaying(page);
    await expectVolume(page, 0.3);
    expect((await element(page)).muted).toBe(true);
    await expect(slider(page)).toHaveValue('30');
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'true');
  });

  test('a reload starts again at full volume, unmuted', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    await slider(page).fill('20');
    await muteButton(page).click();

    await page.reload();
    await expect(slider(page)).toHaveValue('100');
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'false');
    const after = await element(page);
    expect(after.muted).toBe(false);
    // Nothing of the old settings is stored for the next visit.
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(stored).not.toMatch(/volume|muted/i);
  });
});

test.describe('Controls are visible and accessible on the room page', () => {
  test('the mute button and slider are visible, named and touch sized', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    for (const control of [muteButton(page), slider(page)]) {
      await expect(control).toBeVisible();
      const box = (await control.boundingBox())!;
      expect(box.height, 'touch target').toBeGreaterThanOrEqual(44);
    }
    await expect(slider(page)).toHaveAttribute('aria-valuetext', '100%');
    await muteButton(page).click();
    await expect(slider(page)).toHaveAttribute('aria-valuetext', '100%, muted');
  });

  test('they are shown while "Tap to listen" waits for a tap', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    await blockAutoplay(page);
    await page.goto(`/rooms/${room.id}`);
    await expect(page.getByRole('button', { name: 'Tap to listen' })).toBeVisible();
    await expect(muteButton(page)).toBeVisible();
    await expect(slider(page)).toBeVisible();
  });

  test('both are reached with Tab, show a focus outline and work from the keyboard', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    await page.locator('body').click({ position: { x: 1, y: 1 } });

    for (const control of [muteButton(page), slider(page)]) {
      let reached = false;
      for (let i = 0; i < 10 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await control.evaluate((c) => c === document.activeElement);
      }
      expect(reached, 'reachable with Tab').toBe(true);
      const focus = await control.evaluate((c) => ({
        visible: c.matches(':focus-visible'),
        outline: getComputedStyle(c).outlineStyle,
      }));
      expect(focus.visible).toBe(true);
      expect(focus.outline).not.toBe('none');
    }

    await muteButton(page).focus();
    await page.keyboard.press('Space');
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Enter');
    await expect(muteButton(page)).toHaveAttribute('aria-pressed', 'false');
    expect((await element(page)).muted).toBe(false);
  });
});
