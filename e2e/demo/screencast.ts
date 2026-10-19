import { test as base, type Locator, type Page } from '@playwright/test';

// Playwright's recordings show no pointer and have no sound, so demos draw both a cursor that
// follows the mouse and a caption bar that says what is happening. The caption is kept in
// sessionStorage so it survives page navigations.
async function installOverlay(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __demoCaption: (text: string) => void };
    const mount = () => {
      if (document.getElementById('demo-cursor')) return;
      const style = document.createElement('style');
      style.textContent = `
        #demo-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; margin: -11px 0 0 -11px;
          border-radius: 50%; background: rgba(255, 196, 0, 0.55); border: 2px solid #111; pointer-events: none;
          transition: transform 0.12s; left: -100px; top: -100px; }
        #demo-cursor.down { transform: scale(0.7); background: rgba(255, 120, 0, 0.8); }
        #demo-caption { position: fixed; z-index: 2147483646; left: 50%; bottom: 28px; transform: translateX(-50%);
          max-width: 80%; padding: 12px 22px; border-radius: 10px; background: rgba(0, 0, 0, 0.82); color: #fff;
          font: 600 22px/1.35 system-ui, sans-serif; text-align: center; pointer-events: none; }
        #demo-caption:empty { display: none; }`;
      const cursor = document.createElement('div');
      cursor.id = 'demo-cursor';
      const caption = document.createElement('div');
      caption.id = 'demo-caption';
      caption.textContent = sessionStorage.getItem('demoCaption') ?? '';
      document.documentElement.append(style, cursor, caption);
      window.addEventListener('mousemove', (e) => {
        cursor.style.left = `${e.clientX}px`;
        cursor.style.top = `${e.clientY}px`;
      }, true);
      window.addEventListener('mousedown', () => cursor.classList.add('down'), true);
      window.addEventListener('mouseup', () => cursor.classList.remove('down'), true);
    };
    w.__demoCaption = (text: string) => {
      sessionStorage.setItem('demoCaption', text);
      mount();
      document.getElementById('demo-caption')!.textContent = text;
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
    else mount();
  });
}

/** Like Playwright's `test`, with the cursor and caption overlay on every page. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await installOverlay(page);
    await use(page);
  },
});

/** Shows `text` in the caption bar and holds it long enough to read. */
export async function caption(page: Page, text: string, holdMs = 2000) {
  await page.evaluate((t) => (window as unknown as { __demoCaption: (t: string) => void }).__demoCaption(t), text);
  await page.waitForTimeout(holdMs);
}

/** Glides the visible cursor to the element, so viewers can follow where the click lands. */
async function moveTo(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
}

export async function click(page: Page, target: Locator) {
  await moveTo(page, target);
  await target.click();
  await page.waitForTimeout(400);
}

/** Types at a readable speed instead of filling the field instantly. */
export async function typeInto(page: Page, target: Locator, text: string) {
  await click(page, target);
  await target.pressSequentially(text, { delay: 70 });
}
