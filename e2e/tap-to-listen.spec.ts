import { expect, test, type Page } from '@playwright/test';
import { audio, blockAutoplay, createRoomWithTracks, enterRoom, expectPlaying } from './room';

const tapToListen = (page: Page) => page.getByRole('button', { name: 'Tap to listen' });
const paused = (page: Page) => audio(page).evaluate((a: HTMLAudioElement) => a.paused);

// Loading the room URL directly gives no user gesture, so play() is rejected.
async function openBlocked(page: Page, roomId: string) {
  await blockAutoplay(page);
  await page.goto(`/rooms/${roomId}`);
  await expect(tapToListen(page)).toBeVisible();
  expect(await paused(page), 'nothing plays before the tap').toBe(true);
}

test.describe('If autoplay is blocked, a "Tap to listen" button appears', () => {
  test('the button appears when the browser blocks autoplay', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    await openBlocked(page, room.id);
    const box = (await tapToListen(page).boundingBox())!;
    expect(box.height, 'prominent touch target').toBeGreaterThanOrEqual(44);
  });

  test('the button does not appear when autoplay is allowed', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    await enterRoom(page, room.name);
    await expectPlaying(page);
    await expect(tapToListen(page)).toHaveCount(0);
  });
});

test('One tap or click starts playback and hides the button', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 2);
  await openBlocked(page, room.id);
  await tapToListen(page).click();
  await expectPlaying(page);
  await expect(tapToListen(page)).toHaveCount(0);
  const id = await audio(page).evaluate((a: HTMLAudioElement) => a.dataset.trackId);
  expect(room.tracks.map((t) => t.id), 'the pending layer plays').toContain(id);
});

test.describe('The button is keyboard accessible (operable via Enter/Space, visible focus state)', () => {
  // Tabs from the top of the page, as a keyboard user would, until the button has focus.
  async function tabToButton(page: Page) {
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Tab');
      if (await tapToListen(page).evaluate((b) => b === document.activeElement)) return;
    }
    throw new Error('"Tap to listen" is not reachable with Tab');
  }

  test('focusing the button with Tab shows a visible focus outline', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 2);
    await openBlocked(page, room.id);
    await tabToButton(page);
    const focus = await tapToListen(page).evaluate((b) => {
      const style = getComputedStyle(b);
      return { visible: b.matches(':focus-visible'), outline: style.outlineStyle, width: style.outlineWidth };
    });
    expect(focus.visible).toBe(true);
    expect(focus.outline).not.toBe('none');
    expect(parseFloat(focus.width)).toBeGreaterThan(0);
    await expect(tapToListen(page)).toBeFocused();
  });

  for (const key of ['Enter', 'Space']) {
    test(`pressing ${key} starts playback and hides the button`, async ({ page, request }) => {
      const room = await createRoomWithTracks(request, 2);
      await openBlocked(page, room.id);
      await tabToButton(page);
      await page.keyboard.press(key);
      await expectPlaying(page);
      await expect(tapToListen(page)).toHaveCount(0);
    });
  }
});
