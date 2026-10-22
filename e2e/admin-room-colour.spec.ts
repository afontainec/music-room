import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { ROOM_PALETTE, defaultColour } from '../server/src/palette';
import { adminHeaders, asStaff } from './admin';

const unique = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const NAMES = ['Moss', 'Sky', 'Lavender', 'Sand', 'Coral', 'Teal', 'Gold', 'Rose'];

const newRoomColours = (page: Page) => page.getByRole('group', { name: 'New room colour' });
const roomColours = (page: Page) => page.getByRole('group', { name: 'Room colour' });
const checkedValue = (group: ReturnType<typeof newRoomColours>) => group.getByRole('radio', { checked: true }).getAttribute('value');

async function allRooms(request: APIRequestContext) {
  const res = await request.get('/api/rooms', { headers: await adminHeaders(request) });
  return (await res.json()) as { id: string; name: string; colour: string }[];
}

async function createViaApi(request: APIRequestContext, colour?: string) {
  const res = await request.post('/api/rooms', { headers: await adminHeaders(request), data: { name: unique(), colour } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; name: string; colour: string };
}

async function openStaffArea(page: Page) {
  await asStaff(page);
  await page.goto('/admin');
  await expect(page.getByRole('list', { name: 'Rooms' })).toBeVisible();
}

async function createInUi(page: Page, name: string) {
  await page.getByLabel('New room name').fill(name);
  await page.getByRole('button', { name: 'Create room' }).click();
  await expect(page.getByRole('list', { name: 'Rooms' }).getByRole('link', { name, exact: true })).toBeVisible();
  return (await allRooms(page.request)).find((r) => r.name === name)!;
}

test('The create-room form pre-selects the palette colour the API would default to, shown as palette swatches staff can override before saving', async ({
  page,
}) => {
  await createViaApi(page.request);
  // Other tests create rooms in parallel, so compare against a list fetched right after the page's.
  await expect(async () => {
    await openStaffArea(page);
    const shown = await checkedValue(newRoomColours(page));
    expect(shown).toBe(defaultColour((await allRooms(page.request)).map((r) => r.colour)));
  }).toPass();

  // Kept as is, the room gets the pre-selected colour.
  const shown = await checkedValue(newRoomColours(page));
  const kept = await createInUi(page, unique());
  expect(kept.colour).toBe(shown);

  // Overridden, it gets the chosen one; the form then follows the default again.
  const coral = newRoomColours(page).getByRole('radio', { name: 'Coral' });
  await coral.check();
  await expect(coral).toBeChecked();
  const overridden = await createInUi(page, unique());
  expect(overridden.colour).toBe(ROOM_PALETTE[4]);
  await expect(async () => {
    await page.reload();
    const after = await checkedValue(newRoomColours(page));
    expect(after).toBe(defaultColour((await allRooms(page.request)).map((r) => r.colour)));
  }).toPass();
});

test("The room's staff page shows the current colour and lets staff change it to any palette colour via PATCH /api/rooms/:id", async ({
  page,
}) => {
  const room = await createViaApi(page.request, ROOM_PALETTE[1]);
  await asStaff(page);
  await page.goto(`/admin/rooms/${room.id}`);
  await expect(page.getByText('Current colour: Sky')).toBeVisible();
  await expect(roomColours(page).getByRole('radio', { name: 'Sky' })).toBeChecked();
  const save = page.getByRole('button', { name: 'Save colour' });
  await expect(save).toBeDisabled();

  for (const [i, name] of NAMES.entries()) {
    if (i === 1) continue;
    await roomColours(page).getByRole('radio', { name }).check();
    const patch = page.waitForRequest((req) => req.method() === 'PATCH' && req.url().endsWith(`/api/rooms/${room.id}`));
    await save.click();
    expect((await patch).postDataJSON()).toEqual({ colour: ROOM_PALETTE[i] });
    await expect(page.getByText(`Current colour: ${name}`)).toBeVisible();
    await expect(save).toBeDisabled();
  }

  // Saved: the public room has the new colour and keeps its name, and a reload shows it.
  const saved = (await (await page.request.get(`/api/rooms/${room.id}`)).json()) as { name: string; colour: string };
  expect(saved).toMatchObject({ name: room.name, colour: ROOM_PALETTE[7] });
  await page.reload();
  await expect(page.getByText('Current colour: Rose')).toBeVisible();
  await expect(roomColours(page).getByRole('radio', { name: 'Rose' })).toBeChecked();
});

test('Invalid/out-of-palette options are not offered in the UI', async ({ page }) => {
  const room = await createViaApi(page.request);
  await openStaffArea(page);
  const offered = async (group: ReturnType<typeof newRoomColours>) => {
    const radios = group.getByRole('radio');
    await expect(radios).toHaveCount(ROOM_PALETTE.length);
    const values = await radios.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
    expect(values).toEqual([...ROOM_PALETTE]);
    for (const name of NAMES) await expect(group.getByRole('radio', { name })).toHaveCount(1);
  };
  await offered(newRoomColours(page));
  await page.goto(`/admin/rooms/${room.id}`);
  await offered(roomColours(page));
});

test('Actions are disabled while a request is in flight', async ({ page }) => {
  const room = await createViaApi(page.request, ROOM_PALETTE[0]);
  await openStaffArea(page);

  // Hold the requests until the disabled state has been checked.
  let releaseCreate!: () => void;
  const createHeld = new Promise<void>((resolve) => (releaseCreate = resolve));
  await page.route('**/api/rooms', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await createHeld;
    await route.continue();
  });
  const name = unique();
  await page.getByLabel('New room name').fill(name);
  await page.getByRole('button', { name: 'Create room' }).click();
  await expect(page.getByRole('button', { name: 'Creating…' })).toBeDisabled();
  for (const radio of await newRoomColours(page).getByRole('radio').all()) await expect(radio).toBeDisabled();
  releaseCreate();
  await expect(page.getByRole('list', { name: 'Rooms' }).getByRole('link', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create room' })).toBeEnabled();
  await expect(newRoomColours(page).getByRole('radio').first()).toBeEnabled();

  let releasePatch!: () => void;
  const patchHeld = new Promise<void>((resolve) => (releasePatch = resolve));
  await page.route(`**/api/rooms/${room.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    await patchHeld;
    await route.continue();
  });
  await page.goto(`/admin/rooms/${room.id}`);
  await roomColours(page).getByRole('radio', { name: 'Gold' }).check();
  await page.getByRole('button', { name: 'Save colour' }).click();
  await expect(page.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  for (const radio of await roomColours(page).getByRole('radio').all()) await expect(radio).toBeDisabled();
  releasePatch();
  await expect(page.getByText('Current colour: Gold')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save colour' })).toBeDisabled();
  await expect(roomColours(page).getByRole('radio', { name: 'Gold' })).toBeEnabled();
});
