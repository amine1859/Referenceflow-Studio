const assert = require('assert');
const puppeteer = require('puppeteer');

const browserURL = process.argv[2] || 'http://127.0.0.1:9333';
const startupEntryName = process.argv[3] || 'RefFlowStudio Test';
const runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

async function main() {
  const browser = await puppeteer.connect({ browserURL });
  try {
    const pages = await browser.pages();
    const page = pages.find(candidate => candidate.url().startsWith('file:')) || pages[0];
    assert.ok(page, 'The packaged RefFlow renderer was not found.');

    const readStartupEntry = () => page.evaluate(({ key, name }) => {
      try {
        const { execFileSync } = window.require('child_process');
        return execFileSync('reg.exe', ['QUERY', key, '/v', name], {
          encoding: 'utf8',
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        }).trim();
      } catch {
        return '';
      }
    }, { key: runKey, name: startupEntryName });

    await page.waitForSelector('button[title="Settings"]', { timeout: 20_000 });
    const settingsOpen = await page.evaluate(() => Boolean(document.querySelector('input[aria-label="Start on Boot"]')));
    if (!settingsOpen) {
      await page.evaluate(() => document.querySelector('button[title="Settings"]')?.click());
    }
    await page.waitForSelector('input[aria-label="Start on Boot"]', { timeout: 10_000 });

    const setStartup = async expected => {
      const current = await page.evaluate(() => document.querySelector('input[aria-label="Start on Boot"]')?.checked);
      if (current !== expected) {
        await page.evaluate(() => document.querySelector('input[aria-label="Start on Boot"]')?.click());
      }
      await page.waitForFunction(value => {
        const input = document.querySelector('input[aria-label="Start on Boot"]');
        const status = document.querySelector('[data-start-on-boot-status]');
        return Boolean(
          input
          && input.checked === value
          && !input.disabled
          && status
          && !/Enabling|Disabling|Checking/i.test(status.textContent || '')
        );
      }, { timeout: 15_000 }, expected);
      return page.evaluate(() => ({
        checked: document.querySelector('input[aria-label="Start on Boot"]')?.checked,
        message: document.querySelector('[data-start-on-boot-status]')?.textContent?.trim() || ''
      }));
    };

    await setStartup(false);
    const enabled = await setStartup(true);
    assert.strictEqual(enabled.checked, true);
    assert.match(enabled.message, /enabled|start when you sign in/i);
    assert.doesNotMatch(enabled.message, /still reports|could not|did not confirm/i);
    const enabledRegistryEntry = await readStartupEntry();
    assert.match(enabledRegistryEntry, /--background/i);
    assert.match(enabledRegistryEntry, /RefFlowStudio Test\.exe/i);

    const disabled = await setStartup(false);
    assert.strictEqual(disabled.checked, false);
    assert.match(disabled.message, /disabled|is off/i);
    assert.strictEqual(await readStartupEntry(), '', 'The test startup entry should be removed after verification.');

    console.log(JSON.stringify({ enabled, disabled, registryEntryVerified: true, cleanedUp: true }, null, 2));
  } finally {
    browser.disconnect();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
