import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { adminHeaders, asStaff } from './admin';
import { silentMp3 } from './mp3';
import { createRoomWithTracks, layerName } from './room';

// Opens the room from the staff area's room list, the way staff get there.
async function openAdminRoom(page: Page, name: string) {
  await page.goto('/admin');
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
}

const trackList = (page: Page) => page.getByRole('list', { name: 'Tracks' });

async function upload(page: Page, name: string) {
  await page.getByLabel('Mp3 file').setInputFiles({ name, mimeType: 'audio/mpeg', buffer: silentMp3(1) });
  await page.getByRole('button', { name: 'Upload' }).click();
}

async function publicTrackNames(request: APIRequestContext, roomId: string) {
  const tracks = (await (await request.get(`/api/rooms/${roomId}/files`)).json()) as { name: string }[];
  return tracks.map((t) => t.name);
}

test('From a room’s page, staff see a list of all its tracks with their names', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 3, 1);
  await asStaff(page, request);
  await openAdminRoom(page, room.name);
  await expect(page).toHaveURL(`/admin/rooms/${room.id}`);

  await expect(trackList(page).getByRole('listitem')).toHaveText(room.tracks.map(layerName).map((n) => new RegExp(n)));
  for (const track of room.tracks) {
    await expect(page.getByRole('button', { name: `Remove ${layerName(track)}` })).toBeVisible();
  }
});

test('The list updates after a track is uploaded or removed', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 1, 1);
  await asStaff(page, request);
  await openAdminRoom(page, room.name);
  const items = trackList(page).getByRole('listitem');
  await expect(items).toHaveCount(1);

  await upload(page, 'Forest Birds.mp3');
  await expect(items).toHaveCount(2);
  await expect(items.nth(1)).toContainText('Forest Birds');
  await expect(page.getByLabel('Mp3 file')).toHaveValue('');
  expect(await publicTrackNames(request, room.id)).toContain('Forest Birds');

  // Removal asks for confirmation first.
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain('Forest Birds');
    void dialog.accept();
  });
  await page.getByRole('button', { name: 'Remove Forest Birds' }).click();
  await expect(items).toHaveCount(1);
  await expect(trackList(page)).not.toContainText('Forest Birds');
  expect(await publicTrackNames(request, room.id)).toEqual([layerName(room.tracks[0]!)]);

  // Dismissing the confirmation keeps the track.
  page.once('dialog', (dialog) => void dialog.dismiss());
  await page.getByRole('button', { name: `Remove ${layerName(room.tracks[0]!)}` }).click();
  await expect(items).toHaveCount(1);

  // A rejected upload shows the server's reason and leaves the list as it was.
  await page.getByLabel('Mp3 file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hi') });
  await page.getByRole('button', { name: 'Upload' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(items).toHaveCount(1);
});

test('An empty room shows a helpful empty state message', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 0);
  await asStaff(page, request);
  await openAdminRoom(page, room.name);
  await expect(page.getByText('No tracks yet. Upload an mp3 above to give this room its first layer.')).toBeVisible();
  await expect(trackList(page)).toHaveCount(0);

  // The first upload replaces the empty state with the list.
  await upload(page, 'wind.mp3');
  await expect(trackList(page).getByRole('listitem')).toHaveText([/wind/]);
  await expect(page.getByText(/No tracks yet/)).toHaveCount(0);
});

test('Loading and error states are shown when fetching the tracks', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 1, 1);
  await asStaff(page, request);

  // Hold the first request to show the loading state, then fail it.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/api/rooms/${room.id}/files`, async (route) => {
    await held;
    await route.fulfill({ status: 500, json: { error: 'boom' } });
  });
  await openAdminRoom(page, room.name);
  await expect(page.getByText('Loading tracks…')).toBeVisible();
  release();
  await expect(page.getByRole('alert')).toContainText('Could not load the tracks.');
  await expect(trackList(page)).toHaveCount(0);

  // Once the server answers again, "Try again" loads the list.
  await page.unroute(`**/api/rooms/${room.id}/files`);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(trackList(page).getByRole('listitem')).toHaveText([new RegExp(layerName(room.tracks[0]!))]);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

  test('The list works on desktop and mobile browsers', async ({ page, request }) => {
    const room = await createRoomWithTracks(request, 1, 1);
    // A long name must wrap rather than push the remove button off screen.
    const longName = 'A very long layer name for a forest at dawn with birds and a distant stream';
    const up = await request.post(`/api/rooms/${room.id}/files`, {
      headers: await adminHeaders(request),
      multipart: { file: { name: `${longName}.mp3`, mimeType: 'audio/mpeg', buffer: silentMp3(1) } },
    });
    expect(up.status()).toBe(201);
    await asStaff(page, request);
    await openAdminRoom(page, room.name);

    const items = trackList(page).getByRole('listitem');
    await expect(items).toHaveCount(2);
    await expect(items.nth(1)).toContainText(longName);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    for (const name of [layerName(room.tracks[0]!), longName]) {
      // Scrolling down is fine; being pushed off the side of the screen is not.
      const remove = page.getByRole('button', { name: `Remove ${name}` });
      await remove.scrollIntoViewIfNeeded();
      await expect(remove).toBeInViewport();
    }

    await upload(page, 'rain.mp3');
    await expect(items).toHaveCount(3);
    page.once('dialog', (dialog) => void dialog.accept());
    await page.getByRole('button', { name: 'Remove rain' }).tap();
    await expect(items).toHaveCount(2);
  });
});

const addMode = (page: Page, name: 'Upload file' | 'Add by URL') =>
  page.getByRole('group', { name: 'Add a track' }).getByRole('radio', { name });

test('The add-track area offers Upload file (default) and Add by URL, and upload keeps working', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 0);
  await asStaff(page, request);
  await openAdminRoom(page, room.name);

  await expect(addMode(page, 'Upload file')).toBeChecked();
  await expect(addMode(page, 'Add by URL')).not.toBeChecked();
  await expect(page.getByLabel('Mp3 URL')).toHaveCount(0);

  // Switching to the URL form and back leaves the upload path as it was.
  await addMode(page, 'Add by URL').check();
  await expect(page.getByLabel('Mp3 file')).toHaveCount(0);
  await addMode(page, 'Upload file').check();
  await upload(page, 'birds.mp3');
  await expect(trackList(page).getByRole('listitem')).toHaveText([/birds/]);
  expect(await publicTrackNames(request, room.id)).toEqual(['birds']);
});

test('Add by URL shows a URL field whose submit is disabled while empty', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 0);
  await asStaff(page, request);
  await openAdminRoom(page, room.name);

  await addMode(page, 'Add by URL').check();
  const field = page.getByLabel('Mp3 URL');
  const submit = page.getByRole('button', { name: 'Add track' });
  await expect(field).toBeVisible();
  await expect(submit).toBeDisabled();
  await field.fill('   ');
  await expect(submit).toBeDisabled();
  await field.fill('https://cdn.example.com/river.mp3');
  await expect(submit).toBeEnabled();
});

test('A valid URL is added, shows success and appears in the list without a refresh', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 1, 1);
  await asStaff(page, request);
  await openAdminRoom(page, room.name);
  const items = trackList(page).getByRole('listitem');
  await expect(items).toHaveCount(1);

  await addMode(page, 'Add by URL').check();
  await page.getByLabel('Mp3 URL').fill('https://cdn.example.com/sounds/river-stream.mp3');
  await page.getByRole('button', { name: 'Add track' }).click();

  await expect(page.getByRole('status')).toHaveText('Track added from the URL.');
  await expect(items).toHaveCount(2);
  await expect(items.nth(1)).toContainText('river-stream');
  await expect(page.getByLabel('Mp3 URL')).toHaveValue('');
  await expect(page.getByRole('alert')).toHaveCount(0);

  // Visitors get it too: the public list has it, and it redirects to the external file.
  const files = (await (await request.get(`/api/rooms/${room.id}/files`)).json()) as { id: string; name: string }[];
  const added = files.find((f) => f.name === 'river-stream')!;
  const res = await request.get(`/api/files/${added.id}`, { maxRedirects: 0 });
  expect(res.status()).toBe(302);
  expect(res.headers().location).toBe('https://cdn.example.com/sounds/river-stream.mp3');
});

test('An invalid or rejected URL shows the server’s error and adds no track', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 1, 1);
  await asStaff(page, request);
  await openAdminRoom(page, room.name);
  const items = trackList(page).getByRole('listitem');
  await expect(items).toHaveCount(1);
  await addMode(page, 'Add by URL').check();
  const field = page.getByLabel('Mp3 URL');

  const rejected: [string, string][] = [
    ['https://cdn.example.com/notes.wav', 'url must point to an .mp3 file'],
    ['ftp://cdn.example.com/river.mp3', 'url must be http or https'],
    ['not a url', 'url is not a valid URL'],
  ];
  for (const [url, error] of rejected) {
    await field.fill(url);
    await page.getByRole('button', { name: 'Add track' }).click();
    await expect(page.getByRole('alert')).toHaveText(error);
    await expect(page.getByRole('status')).toHaveCount(0);
    // The URL stays in the field so staff can correct it.
    await expect(field).toHaveValue(url);
  }
  await expect(items).toHaveCount(1);
  expect(await publicTrackNames(request, room.id)).toEqual([layerName(room.tracks[0]!)]);
});

test('Only authenticated staff can add by URL, and a loading state blocks double submits', async ({ page, request }) => {
  const room = await createRoomWithTracks(request, 0);
  const route = `**/api/rooms/${room.id}/files/url`;

  // The endpoint itself refuses requests without a staff token.
  const anonymous = await request.post(`/api/rooms/${room.id}/files/url`, { data: { url: 'https://cdn.example.com/a.mp3' } });
  expect(anonymous.status()).toBe(401);

  await asStaff(page, request);
  await openAdminRoom(page, room.name);
  await addMode(page, 'Add by URL').check();

  // Hold the request: the button shows the loading state and further submits send nothing.
  let posts = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(route, async (r) => {
    posts++;
    await held;
    await r.continue();
  });
  await page.getByLabel('Mp3 URL').fill('https://cdn.example.com/wind.mp3');
  await page.getByRole('button', { name: 'Add track' }).click();
  const adding = page.getByRole('button', { name: 'Adding…' });
  await expect(adding).toBeDisabled();
  await page.getByLabel('Mp3 URL').press('Enter');
  await adding.click({ force: true });
  release();
  await expect(trackList(page).getByRole('listitem')).toHaveText([/wind/]);
  expect(posts).toBe(1);
  expect(await publicTrackNames(request, room.id)).toEqual(['wind']);

  // A request without the staff token is refused: staff go back to the login and nothing is added.
  await page.unroute(route);
  await page.route(route, (r) => {
    const headers = { ...r.request().headers() };
    delete headers.authorization;
    return r.continue({ headers });
  });
  await page.getByLabel('Mp3 URL').fill('https://cdn.example.com/rain.mp3');
  await page.getByRole('button', { name: 'Add track' }).click();
  await expect(page).toHaveURL('/admin/login');
  expect(await publicTrackNames(request, room.id)).toEqual(['wind']);
});
