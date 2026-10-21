import { expect, test, type Page } from '@playwright/test';
import { STAFF } from './admin';
import { silentMp3 } from './mp3';
import { audio, enterRoom, expectPlaying } from './room';

const unique = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function logIn(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Username').fill(STAFF.username);
  await page.getByLabel('Password').fill(STAFF.password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page).toHaveURL('/admin');
}

async function createRoom(page: Page, name: string) {
  await page.getByLabel('New room name').fill(name);
  await page.getByRole('button', { name: 'Create room' }).click();
  await expect(page.getByRole('list', { name: 'Rooms' }).getByRole('link', { name, exact: true })).toBeVisible();
  await expect(page.getByLabel('New room name')).toHaveValue('');
}

async function openAdminRoom(page: Page, name: string) {
  await page.getByRole('list', { name: 'Rooms' }).getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

async function upload(page: Page, name: string, seconds = 1) {
  await page.getByLabel('Mp3 file').setInputFiles({ name, mimeType: 'audio/mpeg', buffer: silentMp3(seconds) });
  await page.getByRole('button', { name: 'Upload' }).click();
}

const trackList = (page: Page) => page.getByRole('list', { name: 'Tracks' });
const publicRooms = (page: Page) => page.getByRole('list', { name: 'Rooms' }).getByRole('link');

test('Authenticated users can log in to a management view', async ({ page }) => {
  // Without a login the management view sends staff to the login form.
  await page.goto('/admin');
  await expect(page).toHaveURL('/admin/login');

  await logIn(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Staff area');
  await expect(page.getByRole('heading', { name: 'Rooms' })).toBeVisible();
  await expect(page.getByLabel('New room name')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create room' })).toBeVisible();
});

test('Users can create/delete rooms', async ({ page }) => {
  const name = unique();
  await logIn(page);

  // An empty name is refused in the browser, a duplicate by the server.
  await page.getByRole('button', { name: 'Create room' }).click();
  await expect(page.getByRole('alert')).toHaveText('Enter a name for the room.');
  await createRoom(page, name);
  await page.getByLabel('New room name').fill(name);
  await page.getByRole('button', { name: 'Create room' }).click();
  await expect(page.getByRole('alert')).toHaveText(`A room named "${name}" already exists`);

  // Rename from the room's page; a name taken by another room is refused.
  const other = unique();
  await createRoom(page, other);
  await openAdminRoom(page, name);
  const renamed = `${name}-renamed`;
  await page.getByLabel('Room name').fill(other);
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('alert')).toHaveText(`A room named "${other}" already exists`);
  await page.getByLabel('Room name').fill(renamed);
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(renamed);
  await expect(page.getByRole('alert')).toHaveCount(0);

  // Dismissing the confirmation keeps the room; accepting deletes it and returns to the list.
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByRole('button', { name: 'Delete room' }).click();
  await expect(page).toHaveURL(/\/admin\/rooms\//);
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain(renamed);
    void dialog.accept();
  });
  await page.getByRole('button', { name: 'Delete room' }).click();
  await expect(page).toHaveURL('/admin');
  const rooms = page.getByRole('list', { name: 'Rooms' });
  await expect(rooms.getByRole('link', { name: other, exact: true })).toBeVisible();
  await expect(rooms.getByRole('link', { name: renamed, exact: true })).toHaveCount(0);
});

test('Users can upload, list, and remove mp3 files per room', async ({ page }) => {
  const first = unique();
  const second = unique();
  await logIn(page);
  await createRoom(page, first);
  await createRoom(page, second);

  await openAdminRoom(page, first);
  await upload(page, 'Birds.mp3');
  await upload(page, 'Wind.mp3');
  await expect(trackList(page).getByRole('listitem')).toHaveText([/Birds/, /Wind/]);

  // Tracks belong to their room: the other room is still empty.
  await page.getByRole('link', { name: '← All rooms' }).click();
  await openAdminRoom(page, second);
  await expect(page.getByText(/No tracks yet/)).toBeVisible();
  await upload(page, 'Stream.mp3');
  await expect(trackList(page).getByRole('listitem')).toHaveText([/Stream/]);

  await page.getByRole('link', { name: '← All rooms' }).click();
  await openAdminRoom(page, first);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Remove Birds' }).click();
  await expect(trackList(page).getByRole('listitem')).toHaveText([/Wind/]);
});

// One page switches between the staff area and the public app, so the recording shows both.
test('Changes reflect immediately in the public-facing app', async ({ page }) => {
  const name = unique();
  await logIn(page);
  const backToAdminRoom = async (roomName: string) => {
    await page.goto('/admin');
    await openAdminRoom(page, roomName);
  };

  // A created room shows up on the public selection page.
  await createRoom(page, name);
  await page.goto('/');
  await expect(publicRooms(page).getByText(name, { exact: true })).toHaveCount(1);

  // An uploaded track plays as soon as a visitor enters the room.
  await backToAdminRoom(name);
  await upload(page, 'Forest.mp3', 30);
  await expect(trackList(page).getByRole('listitem')).toHaveText([/Forest/]);
  await enterRoom(page, name);
  await expectPlaying(page);
  await expect(page.getByText(/Forest/)).toBeVisible();
  expect(new URL(await audio(page).evaluate((a: HTMLAudioElement) => a.currentSrc)).pathname).toMatch(/^\/api\/files\//);

  // A removed track is no longer handed out: the room is empty for the next visitor.
  await backToAdminRoom(name);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Remove Forest' }).click();
  await expect(page.getByText(/No tracks yet/)).toBeVisible();
  await enterRoom(page, name);
  await expect(page.getByText('This room has no tracks yet.')).toBeVisible();
  await expect(page.getByText(/Forest/)).toHaveCount(0);

  // A renamed room shows its new name, and a deleted one disappears.
  await backToAdminRoom(name);
  const renamed = `${name}-renamed`;
  await page.getByLabel('Room name').fill(renamed);
  await page.getByRole('button', { name: 'Rename' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(renamed);
  await page.goto('/');
  await expect(publicRooms(page).getByText(renamed, { exact: true })).toHaveCount(1);
  await expect(publicRooms(page).getByText(name, { exact: true })).toHaveCount(0);

  await backToAdminRoom(renamed);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete room' }).click();
  await expect(page).toHaveURL('/admin');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Where are you?');
  await expect(page.getByText(renamed)).toHaveCount(0);
});
