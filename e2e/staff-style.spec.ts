import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { adminHeaders, asStaff, STAFF } from './admin';

// The staff login and room list restyled per docs/design/visual-style.md (staff area section).

const unique = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function createRoom(request: APIRequestContext, colour?: string) {
  const res = await request.post('/api/rooms', { headers: await adminHeaders(request), data: { name: unique(), colour } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; name: string; colour: string };
}

const css = (page: Page, selector: string, property: string) =>
  page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), property);
const roomLink = (page: Page, name: string) =>
  page.getByRole('list', { name: 'Rooms' }).getByRole('link', { name, exact: true });

async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 100 && !(await target.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

async function expectFocusOutline(target: Locator) {
  await expect(target).toHaveCSS('outline-style', 'solid');
  await expect(target).toHaveCSS('outline-width', '2px');
  await expect(target).toHaveCSS('outline-color', 'rgb(237, 239, 238)');
}

test.describe('Login and room list pages use the dark style from docs/design/visual-style.md', () => {
  test('login: dark background, Geist title, form on a surface card', async ({ page }) => {
    await page.goto('/admin/login');
    await expect(page.getByText('Music Rooms', { exact: true })).toBeVisible();
    const title = page.getByRole('heading', { level: 1 });
    await expect(title).toHaveText('Staff login');
    expect(await css(page, 'body', 'background-color')).toBe('rgb(13, 17, 16)');
    await expect(title).toHaveCSS('font-size', '36px');
    await expect(title).toHaveCSS('font-weight', '300');
    expect(await css(page, 'h1', 'font-family')).toContain('Geist');

    const form = page.locator('form');
    await expect(form).toHaveCSS('background-color', 'rgb(21, 27, 25)'); // --surface
    await expect(form).toHaveCSS('border-radius', '22px');
    await expect(form).toHaveCSS('box-shadow', 'none'); // no glow in the staff area
    await expect(page.getByLabel('Username')).toHaveCSS('background-color', 'rgb(34, 42, 39)'); // --surface-raised
    await expect(page.getByLabel('Username')).toHaveCSS('color', 'rgb(237, 239, 238)');
    await expect(page.getByRole('button', { name: 'Log in' })).toHaveCSS('background-color', 'rgb(237, 239, 238)');
    await expect(page.getByRole('button', { name: 'Log in' })).toHaveCSS('color', 'rgb(13, 17, 16)');
  });

  test('room list: the same tokens, rooms and the create form on surface cards', async ({ page, request }) => {
    await asStaff(page);
    const room = await createRoom(request);
    await page.goto('/admin');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Staff area');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('font-weight', '300');
    expect(await css(page, 'body', 'background-color')).toBe('rgb(13, 17, 16)');
    await expect(roomLink(page, room.name)).toBeVisible();
    await expect(page.getByRole('list', { name: 'Rooms' })).toHaveCSS('background-color', 'rgb(21, 27, 25)');
    await expect(page.locator('form')).toHaveCSS('background-color', 'rgb(21, 27, 25)');
    await expect(page.getByLabel('New room name')).toHaveCSS('background-color', 'rgb(34, 42, 39)');
    await expect(page.getByText(`Signed in as ${STAFF.username}.`)).toHaveCSS('color', 'rgb(152, 163, 158)');
    await expect(page.getByRole('button', { name: 'Log out' })).toHaveCSS('background-color', 'rgb(34, 42, 39)');
  });
});

test('Forms and buttons are readable and keyboard-accessible', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 851 });
  await page.goto('/admin/login');
  const username = page.getByLabel('Username');
  const password = page.getByLabel('Password');
  const submit = page.getByRole('button', { name: 'Log in' });
  for (const control of [username, password, submit]) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  // Labels and field text in the primary text colour, at least 14px.
  expect(await css(page, '.staff-field', 'color')).toBe('rgb(237, 239, 238)');
  expect(parseFloat(await css(page, '.staff-field', 'font-size'))).toBeGreaterThanOrEqual(14);

  // Keyboard only: tab through the fields, each with a visible outline, and submit with Enter.
  await tabTo(page, username);
  await expectFocusOutline(username);
  await page.keyboard.type(STAFF.username);
  await page.keyboard.press('Tab');
  await expect(password).toBeFocused();
  await expectFocusOutline(password);
  await page.keyboard.type(STAFF.password);
  await page.keyboard.press('Tab');
  await expect(submit).toBeFocused();
  await expectFocusOutline(submit);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/admin');

  // The room list: the create form and a room link work from the keyboard too.
  const name = unique();
  const field = page.getByLabel('New room name');
  await tabTo(page, field);
  await expectFocusOutline(field);
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  const link = roomLink(page, name);
  await expect(link).toBeVisible();
  await expect(field).toHaveValue('');
  // Past the create button the next stops are the room links, each one link with an outline.
  await expect(field).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Create room' })).toBeFocused();
  await page.keyboard.press('Tab');
  const first = page.getByRole('list', { name: 'Rooms' }).getByRole('link').first();
  await expect(first).toBeFocused();
  await expectFocusOutline(first);
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // The rooms before it may be many (other tests share the database), so jump to ours.
  await link.focus();
  await expectFocusOutline(link);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/admin\/rooms\//);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);

  // Nothing overflows the phone width.
  await page.goto('/admin');
  await expect(roomLink(page, name)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(393);
});

test("Room list shows each room's colour", async ({ page, request }) => {
  await asStaff(page);
  const sky = await createRoom(request, '#7fa8e0');
  const sand = await createRoom(request, '#e0ae7f');
  const assigned = await createRoom(request);
  await page.goto('/admin');

  const dot = (name: string) => roomLink(page, name).locator('.staff-room-dot');
  await expect(dot(sky.name)).toHaveCSS('background-color', 'rgb(127, 168, 224)');
  await expect(dot(sky.name)).toHaveCSS('box-shadow', 'none');
  await expect(dot(sand.name)).toHaveCSS('background-color', 'rgb(224, 174, 127)');
  await expect(dot(assigned.name)).toHaveCSS('background-color', /^rgb\(/);

  // Not colour alone: the colour's name is shown and is the link's description; the name is the room's.
  await expect(roomLink(page, sky.name)).toContainText('Sky');
  await expect(roomLink(page, sky.name)).toHaveAccessibleDescription('Sky');
  await expect(roomLink(page, sand.name)).toHaveAccessibleDescription('Sand');
  await expect(roomLink(page, sky.name)).toHaveAccessibleName(sky.name);
});
