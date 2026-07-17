const assert = require('assert');
const puppeteer = require('puppeteer');
const { version: expectedVersion } = require('../package.json');

const browserURL = process.argv[2] || 'http://127.0.0.1:9333';
const startupEntryName = process.argv[3] || 'RefFlowStudio Test';
const startupExecutablePattern = new RegExp(`${startupEntryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.exe`, 'i');
const runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';

async function main() {
  const browser = await puppeteer.connect({ browserURL });
  try {
    const pages = await browser.pages();
    const page = pages.find(candidate => candidate.url().startsWith('file:')) || pages[0];
    assert.ok(page, 'The packaged RefFlow renderer was not found.');
    await page.bringToFront();

    await page.waitForSelector('.floating-pill[data-pill-drag-rendering="imperative"]', { timeout: 20_000 });
    const packagedVersion = await page.evaluate(() => window.require('electron').ipcRenderer.invoke('get-update-status'));
    assert.strictEqual(packagedVersion.currentVersion, expectedVersion);
    assert.ok(packagedVersion.phase, 'The packaged updater should report a runtime phase.');

    const displayLayout = await page.evaluate(() => window.require('electron').ipcRenderer.invoke('get-display-layout'));
    assert.ok(Array.isArray(displayLayout.displays) && displayLayout.displays.length > 0, 'Electron should expose at least one display.');
    assert.ok(displayLayout.displays.some(display => display.isPrimary), 'The display layout should identify the primary monitor.');
    assert.ok(displayLayout.virtual.width > 0 && displayLayout.virtual.height > 0, 'The virtual multi-monitor bounds should be usable.');

    const settingsInitiallyOpen = await page.evaluate(() => Boolean(document.querySelector('input[aria-label="Start on Boot"]')));
    if (settingsInitiallyOpen) {
      await page.evaluate(() => document.querySelector('button[title="Settings"]')?.click());
    }
    const welcomeShown = Boolean(await page.$('[data-empty-board-prompt]'));
    if (welcomeShown) {
      await page.evaluate(() => document.querySelector('button[aria-label="Close start board menu"]')?.click());
      await page.waitForFunction(() => !document.querySelector('[data-empty-board-prompt]'));
    }

    assert.strictEqual(await page.$$eval('[data-expanded-pill-brand] svg', elements => elements.length), 0, 'The packaged expanded pill should not show the stars icon.');
    const pillActionColors = await page.$$eval('[data-pill-main-action]', buttons => buttons.map(button => getComputedStyle(button).color));
    assert.strictEqual(pillActionColors.length, 4, 'The packaged pill should show all four primary actions.');
    assert.ok(pillActionColors.every(color => color === 'rgb(255, 255, 255)'), `Packaged pill actions should be white at rest: ${pillActionColors.join(', ')}.`);
    await page.hover('[data-pill-main-action]');
    await new Promise(resolve => setTimeout(resolve, 240));
    assert.strictEqual(await page.$eval('[data-pill-main-action]', button => getComputedStyle(button).color), 'rgb(94, 107, 255)', 'Packaged pill actions should turn purple on hover.');
    const pillResizeFrame = await page.$eval('[data-invisible-resize-frame="pill"]', frame => ({
      edges: frame.querySelectorAll('[data-resize-edge]').length,
      visibleGrips: frame.querySelectorAll('[data-visible-resize-grip]').length
    }));
    assert.strictEqual(pillResizeFrame.edges, 8, 'The packaged pill should expose all invisible resize zones.');
    assert.strictEqual(pillResizeFrame.visibleGrips, 0, 'The packaged pill resize zones should have no visible grips.');
    await page.mouse.move(2200, 900);

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

    await page.waitForSelector('button[title="Manage no-key search sources"]', { timeout: 10_000 });
    await page.click('button[title="Manage no-key search sources"]');
    await page.waitForSelector('[data-settings-section="providers"]', { timeout: 10_000 });
    const searchSources = await page.evaluate(() => ({
      providers: Array.from(document.querySelectorAll('[data-settings-section="providers"] [data-provider]'))
        .map(card => card.getAttribute('data-provider')).sort(),
      apiInputCount: document.querySelectorAll('#provider-api-key-input').length
    }));
    assert.deepStrictEqual(searchSources.providers, ['Openverse', 'Wikimedia Commons']);
    assert.strictEqual(searchSources.apiInputCount, 0);
    await page.click('button[title="Back to Settings"]');
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
    assert.match(enabledRegistryEntry, startupExecutablePattern);

    const disabled = await setStartup(false);
    assert.strictEqual(disabled.checked, false);
    assert.match(disabled.message, /disabled|is off/i);
    assert.strictEqual(await readStartupEntry(), '', 'The startup entry should be removed after verification.');

    console.log(JSON.stringify({
      packagedVersion: packagedVersion.currentVersion,
      updaterPhase: packagedVersion.phase,
      displayCount: displayLayout.displays.length,
      virtualDisplayBounds: displayLayout.virtual,
      welcomeDismissed: welcomeShown,
      expandedStarRemoved: true,
      pillActionColors: 'white at rest, purple on hover',
      pillResizeZones: pillResizeFrame.edges,
      searchSources,
      enabled,
      disabled,
      registryEntryVerified: true,
      cleanedUp: true
    }, null, 2));
  } finally {
    browser.disconnect();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
