import { devices, expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { adminHeaders, asStaff } from './admin';
import {
  audio,
  blockAutoplay,
  createRoomWithTracks,
  enterRoom,
  expectPlaying,
  layerName,
  playingTrackId,
  shownLayer,
  type Track,
} from './room';

// The room page restyled per docs/design/visual-style.md ("Mono") and docs/design/room.png.

const { defaultBrowserType: _, ...pixel5 } = devices['Pixel 5'];
const SKY = { hex: '#7fa8e0', rgb: 'rgb(127, 168, 224)' };
const TEXT = 'rgb(237, 239, 238)';
const TEXT_MUTED = 'rgb(152, 163, 158)';
const BG = 'rgb(13, 17, 16)';

const backLink = (page: Page) => page.getByRole('link', { name: 'Rooms', exact: true });
const tapToListen = (page: Page) => page.getByRole('button', { name: 'Tap to listen' });
const css = (page: Page, selector: string, property: string) =>
  page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);
const nameOf = (tracks: Track[], id: string) => layerName(tracks.find((t) => t.id === id)!);

async function skyRoom(request: APIRequestContext, tracks = 2, seconds = 30) {
  const room = await createRoomWithTracks(request, tracks, seconds);
  const res = await request.patch(`/api/rooms/${room.id}`, {
    headers: await adminHeaders(request),
    data: { colour: SKY.hex },
  });
  expect(res.status()).toBe(200);
  return room;
}

test.describe('Matches mockup at phone width: rings (inner ring/dot/glow in room colour), layer name', () => {
  test.use(pixel5);

  test('phone: room name label, rings in the room colour, "Your layer" and the layer name', async ({
    page,
    request,
  }) => {
    const room = await skyRoom(request);
    await page.goto(`/rooms/${room.id}`);

    // Top bar: the room's name as a mono uppercase label.
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(room.name);
    await expect(heading).toHaveCSS('text-transform', 'uppercase');
    await expect(heading).toHaveCSS('font-family', /Geist Mono/);
    await expect(heading).toHaveCSS('color', TEXT_MUTED);

    // Centre: the inner ring, the dot and the glow in the room's colour, the outer rings in the tokens.
    const visual = page.locator('.room-visual');
    await expect(visual.locator('.room-ring-inner')).toHaveCSS('stroke', SKY.rgb);
    await expect(visual.locator('.room-ring-inner')).toHaveCSS('stroke-width', '1.5px');
    await expect(visual.locator('.room-ring-dot')).toHaveCSS('fill', SKY.rgb);
    await expect(visual.locator('.room-glow stop').first()).toHaveCSS('stop-color', SKY.rgb);
    await expect(visual.locator('.room-ring-1')).toHaveCSS('stroke', 'rgb(27, 34, 32)');
    const rings = (await visual.locator('svg').boundingBox())!;
    const width = page.viewportSize()!.width;
    expect(rings.width).toBeLessThanOrEqual(280);
    expect(Math.abs(rings.x + rings.width / 2 - width / 2), 'rings centred').toBeLessThanOrEqual(1);

    // Below: the "Your layer" label and the layer's name in large light type.
    const label = page.getByText('Your layer', { exact: true });
    await expect(label).toBeVisible();
    await expect(label).toHaveCSS('text-transform', 'uppercase');
    const name = shownLayer(page);
    await expect(name).toHaveText(/^track-[12]$/);
    await expect(name).toHaveCSS('font-size', '48px');
    await expect(name).toHaveCSS('font-weight', '300');
    await expect(name).toHaveCSS('color', TEXT);
    const nameBox = (await name.boundingBox())!;
    expect(nameBox.y, 'the layer name sits below the rings').toBeGreaterThan(rings.y + rings.height);
    expect(nameBox.y + nameBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);

    expect(await css(page, 'body', 'background-color')).toBe(BG);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });

  test('the rings scale down on a small phone', async ({ page, request }) => {
    const room = await skyRoom(request);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/rooms/${room.id}`);
    await expect(shownLayer(page)).toBeVisible();
    const rings = (await page.locator('.room-visual svg').boundingBox())!;
    expect(rings.width).toBeLessThan(280);
    expect(rings.width).toBeCloseTo(320 * 0.72, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });
});

test('"← Rooms" shown only to staff with valid session, absent for visitors', async ({ page, request }) => {
  const room = await skyRoom(request, 1);

  await page.goto(`/rooms/${room.id}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(room.name);
  await expect(shownLayer(page)).toHaveText('track-1');
  await expect(backLink(page)).toHaveCount(0);
  await expect(page.getByRole('link')).toHaveCount(0);

  await asStaff(page);
  await page.reload();
  const back = backLink(page);
  await expect(back).toBeVisible();
  await expect(back).toHaveAttribute('href', '/');
  await expect(back.locator('svg')).toHaveAttribute('aria-hidden', 'true'); // the "←"
  await expect(back).toHaveCSS('color', TEXT_MUTED);
  const [link, name] = [await back.boundingBox(), await page.getByRole('heading', { level: 1 }).boundingBox()];
  expect(link!.height).toBeGreaterThanOrEqual(44);
  expect(link!.x, 'back link on the left, room name on the right').toBeLessThan(name!.x);
  await back.hover();
  await expect(back).toHaveCSS('color', TEXT);
});

test('Layer name updates on layer change', async ({ page, request }) => {
  // Longer than the fade, short enough for the test to see the next layer.
  const room = await createRoomWithTracks(request, 3, 4);
  await enterRoom(page, room.name);
  const first = await playingTrackId(page);
  await expect(shownLayer(page)).toHaveText(nameOf(room.tracks, first));

  await expect
    .poll(() => audio(page).evaluate((a: HTMLAudioElement) => a.dataset.trackId), { timeout: 15_000 })
    .not.toBe(first);
  const second = await playingTrackId(page);
  await expect(shownLayer(page)).toHaveText(nameOf(room.tracks, second));
  expect(nameOf(room.tracks, second)).not.toBe(nameOf(room.tracks, first));
});

test.describe('"Tap to listen" keeps behaviour, styled as full-width primary button', () => {
  test.use(pixel5);

  test('the blocked-autoplay button is the full-width pill and still starts playback', async ({ page, request }) => {
    const room = await skyRoom(request);
    await blockAutoplay(page);
    await page.goto(`/rooms/${room.id}`);
    const button = tapToListen(page);
    await expect(button).toBeVisible();

    await expect(button).toHaveCSS('background-color', TEXT);
    await expect(button).toHaveCSS('color', BG);
    await expect(button).toHaveCSS('font-size', '16px');
    await expect(button).toHaveCSS('font-weight', '500');
    await expect(button).toHaveCSS('font-family', /Geist/);
    const box = (await button.boundingBox())!;
    expect(box.height).toBe(52);
    expect(parseFloat(await button.evaluate((b) => getComputedStyle(b).borderTopLeftRadius))).toBeGreaterThanOrEqual(26);
    // Full width: the column's width less its 24px side padding.
    expect(box.x).toBe(24);
    expect(box.width).toBe(page.viewportSize()!.width - 48);
    // It follows the layer name, as the mockup's bottom area.
    expect(box.y).toBeGreaterThan((await shownLayer(page).boundingBox())!.y);

    await button.click();
    await expectPlaying(page);
    await expect(button).toHaveCount(0);
  });
});

test('Centred column on desktop', async ({ page, request }) => {
  const room = await skyRoom(request);
  await page.setViewportSize({ width: 1280, height: 800 });
  await asStaff(page);
  await page.goto(`/rooms/${room.id}`);
  await expect(shownLayer(page)).toBeVisible();

  const column = (await page.getByRole('main').boundingBox())!;
  expect(column.width).toBe(480);
  expect(column.x).toBe((1280 - 480) / 2);
  for (const part of [backLink(page), page.getByRole('heading', { level: 1 }), shownLayer(page)]) {
    const box = (await part.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(column.x);
    expect(box.x + box.width).toBeLessThanOrEqual(column.x + column.width);
  }
  const rings = (await page.locator('.room-visual svg').boundingBox())!;
  expect(rings.width).toBe(280);
  expect(rings.x + rings.width / 2).toBe(640);
});

test('Playback/fade-in/layer assignment unchanged; existing e2e passes', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 2);
  await enterRoom(page, room.name);
  const id = await playingTrackId(page);
  // The server assigned the layer the page plays and shows.
  const presence = await (await request.get(`/api/rooms/${room.id}/presence`)).json();
  expect(presence.devices).toEqual([expect.objectContaining({ trackId: id })]);
  await expect(shownLayer(page)).toHaveText(nameOf(room.tracks, id));
  // The fade-in still brings the layer to full volume.
  await expect.poll(() => audio(page).evaluate((a: HTMLAudioElement) => a.volume), { timeout: 6_000 }).toBe(1);
});

test.describe('Animation respects prefers-reduced-motion', () => {
  const animation = (page: Page) => css(page, '.room-ring-inner', 'animation-name');

  test('the inner ring pulses slowly without a reduced-motion preference', async ({ page, request }) => {
    const room = await skyRoom(request);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(`/rooms/${room.id}`);
    await expect(page.locator('.room-ring-inner')).toHaveCount(1);
    expect(await animation(page)).toBe('room-ring-pulse');
    expect(await css(page, '.room-ring-inner', 'animation-duration')).toBe('4s');
  });

  test('with reduced motion the rings stay still', async ({ page, request }) => {
    const room = await skyRoom(request);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/rooms/${room.id}`);
    await expect(page.locator('.room-ring-inner')).toHaveCount(1);
    expect(await animation(page)).toBe('none');
    expect(await page.evaluate(() => document.getAnimations().length), 'nothing on the page animates').toBe(0);
  });
});
