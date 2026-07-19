const assert = require('assert');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const { version: expectedVersion } = require('../package.json');

const browserURL = process.argv[2] || 'http://127.0.0.1:9333';
const startupEntryName = process.argv[3] || 'RefFlowStudio Test';
const startupExecutablePattern = new RegExp(`${startupEntryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.exe`, 'i');
const runKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const packageMagic = 'REFFLOW-PACKAGE-1\n';
const v2TestRoot = process.env.REFLOW_V2_TEST_ROOT || path.resolve(__dirname, '..', 'dist_test', 'v2-runtime-fixture');

const waitForFile = async filePath => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${filePath}.`);
};

const parseRefFlowPackage = filePath => {
  const packageBuffer = fs.readFileSync(filePath);
  const magicBuffer = Buffer.from(packageMagic, 'utf8');
  assert.ok(packageBuffer.subarray(0, magicBuffer.length).equals(magicBuffer), 'The exported package should use the RefFlow package magic.');
  const headerLength = packageBuffer.readUInt32LE(magicBuffer.length);
  const headerStart = magicBuffer.length + 4;
  const dataStart = headerStart + headerLength;
  assert.ok(headerLength > 0 && dataStart <= packageBuffer.length, 'The exported package header should fit inside the file.');
  return {
    header: JSON.parse(packageBuffer.subarray(headerStart, dataStart).toString('utf8')),
    packageBuffer,
    dataStart
  };
};

async function main() {
  fs.rmSync(v2TestRoot, { recursive: true, force: true });
  fs.mkdirSync(v2TestRoot, { recursive: true });
  const fixtureBuffers = new Map([
    ['poster.psd', Buffer.from('8BPS RefFlow packaged PSD fixture\n', 'utf8')],
    ['marks.ai', Buffer.from('%PDF RefFlow packaged Illustrator fixture\n', 'utf8')],
    ['vector.eps', Buffer.from('%!PS-Adobe RefFlow packaged EPS fixture\n', 'utf8')],
    ['layout.indd', Buffer.from('RefFlow packaged InDesign fixture\n', 'utf8')],
    ['brand.ttf', Buffer.from('RefFlow packaged font fixture\n', 'utf8')]
  ]);
  const fixturePaths = [];
  for (const [fileName, buffer] of fixtureBuffers) {
    const filePath = path.join(v2TestRoot, fileName);
    fs.writeFileSync(filePath, buffer);
    fixturePaths.push(filePath);
  }
  const unsupportedFixturePath = path.join(v2TestRoot, 'unsupported.txt');
  fs.writeFileSync(unsupportedFixturePath, 'unsupported native-open fixture\n', 'utf8');
  const portablePackagePath = path.join(v2TestRoot, 'brand-kit-roundtrip.refflow');

  const browser = await puppeteer.connect({ browserURL });
  try {
    const pages = await browser.pages();
    const page = pages.find(candidate => candidate.url().startsWith('file:')) || pages[0];
    assert.ok(page, 'The packaged RefFlow renderer was not found.');
    await page.bringToFront();
    page.on('dialog', dialog => { void dialog.accept(); });

    await page.waitForSelector('.floating-pill[data-pill-drag-rendering="imperative"]', { timeout: 20_000 });
    const packagedVersion = await page.evaluate(() => window.require('electron').ipcRenderer.invoke('get-update-status'));
    assert.strictEqual(packagedVersion.currentVersion, expectedVersion);
    assert.ok(packagedVersion.phase, 'The packaged updater should report a runtime phase.');

    const installedFontInventory = await page.evaluate(() => window.require('electron').ipcRenderer.invoke('get-installed-fonts', { forceRefresh: true }));
    assert.ok(Array.isArray(installedFontInventory.families) && installedFontInventory.families.length > 0, 'The packaged app should discover installed Windows font families.');
    assert.deepStrictEqual(
      installedFontInventory.families,
      [...new Set(installedFontInventory.families)].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' })),
      'Installed Windows font families should be unique and alphabetized.'
    );

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

    if (await page.$('button[title="Expand Pill"]')) {
      await page.click('button[title="Expand Pill"]');
    }
    await page.waitForSelector('[data-expanded-pill-brand]', { timeout: 10_000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-pill-main-action]').length === 4, { timeout: 10_000 });
    await new Promise(resolve => setTimeout(resolve, 240));
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
    await page.click('button[title="Retract"]');
    await page.waitForSelector('button[title="Expand Pill"] [data-retracted-pill-logo]', { timeout: 10_000 });
    assert.strictEqual(await page.$$eval('button[title="Expand Pill"] svg', elements => elements.length), 0, 'The packaged retracted pill should replace the old sparkle icon with the supplied logo.');
    await page.click('button[title="Expand Pill"]');
    await page.waitForSelector('[data-expanded-pill-brand]', { timeout: 10_000 });

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

    const unsupportedOpen = await page.evaluate(filePath => window.require('electron').ipcRenderer.invoke('open-local-file', filePath), unsupportedFixturePath);
    assert.strictEqual(unsupportedOpen.success, false, 'Native opening should reject unsupported file extensions.');
    const missingOpen = await page.evaluate(filePath => window.require('electron').ipcRenderer.invoke('open-local-file', filePath), path.join(v2TestRoot, 'missing.psd'));
    assert.strictEqual(missingOpen.success, false, 'Native opening should reject missing local assets.');
    assert.strictEqual(
      await page.evaluate(filePath => window.require('electron').ipcRenderer.invoke('reveal-local-file', filePath), unsupportedFixturePath),
      false,
      'Explorer reveal should reject unsupported file extensions.'
    );

    const configuredDataRoot = await page.evaluate(root => window.require('electron').ipcRenderer.invoke('set-default-data-directory', root), v2TestRoot);
    assert.strictEqual(path.resolve(configuredDataRoot), path.resolve(v2TestRoot), 'The packaged app should accept the isolated v2 board root.');

    // Refresh once so the renderer's initialized autosave-root state matches
    // the setting just written through the main process.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.floating-pill[data-pill-drag-rendering="imperative"]', { timeout: 20_000 });
    if (await page.$('[data-empty-board-prompt]')) {
      await page.$eval('button[aria-label="Close start board menu"]', button => button.click());
      await page.waitForFunction(() => !document.querySelector('[data-empty-board-prompt]'));
    }
    if (await page.$('button[title="Expand Pill"]')) {
      await page.$eval('button[title="Expand Pill"]', button => button.click());
      await page.waitForSelector('[data-expanded-pill-brand]', { timeout: 10_000 });
    }

    await page.evaluate(() => {
      if (document.querySelector('input[aria-label="Start on Boot"]')) document.querySelector('button[title="Settings"]')?.click();
    });
    await page.waitForFunction(() => !document.querySelector('input[aria-label="Start on Boot"]'));
    await page.waitForSelector('button[title="Full Screen Manager"]', { timeout: 10_000 });
    await page.evaluate(() => document.querySelector('button[title="Full Screen Manager"]')?.click());
    await page.waitForSelector('[data-brand-kit-template-card]', { timeout: 10_000 });
    await page.$eval('[data-brand-kit-template-card]', button => button.click());
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button[title="Click to rename board"]')).some(button => button.textContent?.trim() === 'Brand Kit'));
    await page.$$eval('.rf-card', cards => {
      const brandKitCard = cards.find(card => card.querySelector('button[title="Click to rename board"]')?.textContent?.trim() === 'Brand Kit');
      const editButton = Array.from(brandKitCard?.querySelectorAll('button') || []).find(button => button.textContent?.trim() === 'Edit Content');
      if (!editButton) throw new Error('The packaged Brand Kit card did not expose Edit Content.');
      editButton.click();
    });
    await page.waitForSelector('[data-board-folder-filter]', { timeout: 10_000 });

    const managerFileInput = await page.$('[data-manager-main] input[type="file"][multiple]');
    assert.ok(managerFileInput, 'The packaged board editor should expose its multi-file input.');
    await managerFileInput.uploadFile(...fixturePaths);
    await page.waitForFunction(() => document.querySelectorAll('[data-board-design-asset]').length === 5, { timeout: 20_000 });
    const assetFolderRouting = await page.$$eval('[data-board-design-asset]', cards => Object.fromEntries(cards.map(card => [
      card.getAttribute('data-board-design-asset'),
      card.querySelector('select')?.selectedOptions?.[0]?.textContent?.trim() || ''
    ])));
    assert.strictEqual(assetFolderRouting.psd, 'Photoshop');
    assert.strictEqual(assetFolderRouting.ai, 'Illustration');
    assert.strictEqual(assetFolderRouting.eps, 'Illustration');
    assert.strictEqual(assetFolderRouting.indd, 'InDesign');
    assert.strictEqual(assetFolderRouting.ttf, 'Typography');
    await page.waitForSelector('[data-pill-preview-type="design-asset"][data-design-kind="ttf"][data-pill-label="brand.ttf"]', { timeout: 10_000 });

    const expectedOriginalPaths = new Map([
      ['poster.psd', path.join(v2TestRoot, 'Brand Kit', 'Photoshop', 'poster.psd')],
      ['marks.ai', path.join(v2TestRoot, 'Brand Kit', 'Illustration', 'marks.ai')],
      ['vector.eps', path.join(v2TestRoot, 'Brand Kit', 'Illustration', 'vector.eps')],
      ['layout.indd', path.join(v2TestRoot, 'Brand Kit', 'InDesign', 'layout.indd')],
      ['brand.ttf', path.join(v2TestRoot, 'Brand Kit', 'Typography', 'brand.ttf')]
    ]);
    for (const [fileName, filePath] of expectedOriginalPaths) {
      await waitForFile(filePath);
      assert.ok(fs.readFileSync(filePath).equals(fixtureBuffers.get(fileName)), `${fileName} should keep its original bytes in the smart folder.`);
    }

    const interceptionReady = await page.evaluate(savePath => {
      const originalRequire = window.require;
      const electron = originalRequire('electron');
      const originalIpcRenderer = electron.ipcRenderer;
      window.__refflowV2Calls = [];
      window.__refflowV2DialogOpenPath = '';
      const ipcRendererProxy = new Proxy(originalIpcRenderer, {
        get(target, property) {
          if (property === 'invoke') {
            return async (channel, ...args) => {
              window.__refflowV2Calls.push({ kind: 'invoke', channel, args });
              if (channel === 'show-save-dialog') return { canceled: false, filePath: savePath };
              if (channel === 'show-open-dialog' && window.__refflowV2DialogOpenPath) return { canceled: false, filePaths: [window.__refflowV2DialogOpenPath] };
              if (channel === 'open-local-file') return { success: true, error: '' };
              if (channel === 'reveal-local-file') return true;
              return target.invoke(channel, ...args);
            };
          }
          if (property === 'send') {
            return (channel, ...args) => {
              window.__refflowV2Calls.push({ kind: 'send', channel, args });
              if (channel !== 'start-drag') return target.send(channel, ...args);
            };
          }
          const value = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
      const electronProxy = new Proxy(electron, {
        get(target, property) {
          if (property === 'ipcRenderer') return ipcRendererProxy;
          const value = Reflect.get(target, property);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
      Object.defineProperty(window, 'require', {
        configurable: true,
        value: moduleName => moduleName === 'electron' ? electronProxy : originalRequire(moduleName)
      });
      return window.require('electron').ipcRenderer !== originalIpcRenderer;
    }, portablePackagePath);
    assert.strictEqual(interceptionReady, true, 'The packaged v2 harness should intercept external side effects without launching creative apps.');

    await page.$eval('[data-board-design-asset="psd"]', card => {
      const openButton = Array.from(card.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Open');
      const folderButton = Array.from(card.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Folder');
      openButton?.click();
      folderButton?.click();
      const dragButton = card.querySelector('button[aria-label^="Drag "]');
      const transfer = new DataTransfer();
      dragButton?.dispatchEvent(new DragEvent('dragstart', { dataTransfer: transfer, bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => window.__refflowV2Calls.filter(call => ['open-local-file', 'reveal-local-file', 'start-drag'].includes(call.channel)).length === 3);
    const externalAssetCalls = await page.evaluate(() => window.__refflowV2Calls.filter(call => ['open-local-file', 'reveal-local-file', 'start-drag'].includes(call.channel)));
    assert.ok(externalAssetCalls.every(call => /poster\.psd$/i.test(call.args[0])), 'Open, reveal, and native drag should all target the original PSD path.');

    await page.$eval('[data-board-folder="Colors"]', button => button.click());
    await page.waitForSelector('[data-brand-colors-panel]');
    await page.type('input[aria-label="Brand color name"]', 'Core Blue');
    await page.$eval('[data-add-brand-color]', button => button.click());
    await page.waitForSelector('[data-brand-color="#5E6BFF"]');
    await page.$eval('[data-board-folder="Typography"]', button => button.click());
    await page.waitForSelector('[data-brand-typography-panel]');
    await page.$eval('[data-load-installed-fonts]', button => button.click());
    await page.waitForSelector('[data-installed-font-picker] select[aria-label="Choose installed Windows font"]', { timeout: 20_000 });
    const installedFontFamilies = await page.$$eval('[data-installed-font-family]', options => options.map(option => option.value));
    assert.deepStrictEqual(installedFontFamilies, installedFontInventory.families, 'The Typography picker should expose every family returned by Windows.');
    const selectedWindowsFont = installedFontFamilies.find(family => family.toLowerCase() === 'arial') || installedFontFamilies[0];
    await page.select('select[aria-label="Choose installed Windows font"]', selectedWindowsFont);
    await page.waitForFunction(fontFamily => document.querySelector('input[aria-label="Font family"]')?.value === fontFamily, {}, selectedWindowsFont);
    await page.$eval('[data-add-brand-typography]', button => button.click());
    await page.waitForSelector('[data-brand-typography="Heading"]');

    await page.$eval('[data-export-current-refflow-package]', button => button.click());
    await waitForFile(portablePackagePath);
    const portablePackage = parseRefFlowPackage(portablePackagePath);
    assert.strictEqual(portablePackage.header.format, 'refflow-board');
    assert.strictEqual(portablePackage.header.formatVersion, 1);
    assert.strictEqual(portablePackage.header.appVersion, expectedVersion);
    assert.strictEqual(portablePackage.header.project.name, 'Brand Kit');
    assert.strictEqual(portablePackage.header.project.boardTemplate, 'brand-kit');
    assert.strictEqual(portablePackage.header.project.folders.length, 18);
    assert.ok(portablePackage.header.project.brandColors.some(color => color.hex === '#5E6BFF' && color.group === 'primary'));
    assert.ok(portablePackage.header.project.brandTypography.some(style => style.name === 'Heading' && style.fontFamily === selectedWindowsFont));
    assert.strictEqual(portablePackage.header.project.designAssets.length, 5);
    let packageOffset = portablePackage.dataStart;
    for (const entry of portablePackage.header.files) {
      const asset = portablePackage.header.project.designAssets.find(item => item.id === entry.assetId);
      assert.ok(asset, `Package file entry ${entry.assetId} should reference a design asset.`);
      const expectedBytes = fixtureBuffers.get(asset.fileName);
      assert.ok(expectedBytes, `The package should retain the source filename ${asset.fileName}.`);
      assert.ok(portablePackage.packageBuffer.subarray(packageOffset, packageOffset + entry.length).equals(expectedBytes), `${asset.fileName} should be byte-identical inside the package.`);
      packageOffset += entry.length;
    }
    assert.strictEqual(packageOffset, portablePackage.packageBuffer.length, 'The package should not contain unexplained trailing data.');

    await page.evaluate(packagePath => { window.__refflowV2DialogOpenPath = packagePath; }, portablePackagePath);
    await page.$eval('button[aria-label="Back to all boards"]', button => button.click());
    await page.waitForFunction(() => document.querySelector('[data-manager-main] h1')?.textContent?.trim() === 'Project Boards');
    await page.$eval('[data-import-refflow-package]', button => button.click());
    await page.waitForFunction(() => document.querySelector('[data-manager-main] h1')?.textContent?.trim() === 'Brand Kit 2', { timeout: 20_000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-board-design-asset]').length === 5, { timeout: 20_000 });
    assert.ok(await page.$('[data-brand-color="#5E6BFF"]'), 'Imported Brand Kits should restore approved brand colors.');
    assert.ok(await page.$('[data-brand-typography="Heading"]'), 'Imported Brand Kits should restore typography roles.');
    assert.strictEqual(await page.$eval('[data-brand-typography="Heading"] input[aria-label="Edit Heading font family"]', input => input.value), selectedWindowsFont, 'Imported Brand Kits should retain the selected installed font family.');
    for (const [fileName, originalPath] of expectedOriginalPaths) {
      const relativeSmartPath = path.relative(path.join(v2TestRoot, 'Brand Kit'), originalPath);
      const restoredPath = path.join(v2TestRoot, 'Brand Kit 2', relativeSmartPath);
      await waitForFile(restoredPath);
      assert.ok(fs.readFileSync(restoredPath).equals(fixtureBuffers.get(fileName)), `${fileName} should survive the RefFlow package round trip.`);
    }

    console.log(JSON.stringify({
      packagedVersion: packagedVersion.currentVersion,
      updaterPhase: packagedVersion.phase,
      displayCount: displayLayout.displays.length,
      virtualDisplayBounds: displayLayout.virtual,
      welcomeDismissed: welcomeShown,
      expandedStarRemoved: true,
      pillActionColors: 'white at rest, purple on hover',
      pillResizeZones: pillResizeFrame.edges,
      retractedPillBranding: 'supplied RefFlow logo',
      searchSources,
      v2AssetRouting: assetFolderRouting,
      installedWindowsFonts: { count: installedFontFamilies.length, selected: selectedWindowsFont },
      fontAssetsInPill: 'imported font files remain visible in the pill',
      nativeAssetActions: 'open, reveal, and drag wiring passed',
      portableBoardRoundTrip: 'five original design/font files plus Brand Kit metadata passed',
      importedBoardFolder: path.join(v2TestRoot, 'Brand Kit 2'),
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
