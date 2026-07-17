const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Document, Packer, Paragraph } = require('docx');
const ExcelJS = require('exceljs');
const mammoth = require('mammoth');
const puppeteer = require('puppeteer');

const PORT = 3017;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const waitForServer = async () => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    try {
      const response = await fetch(ORIGIN);
      if (response.ok) return;
    } catch {
      // Keep waiting while Vite starts.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for the RefFlow test server.');
};

const makePdf = (text) => {
  const escapedText = text.replace(/([\\()])/g, '\\$1');
  const content = `BT /F1 22 Tf 72 720 Td (${escapedText}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach(offset => {
    output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(output);
};

const waitForFile = async (filePath) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${path.basename(filePath)}.`);
};

async function main() {
  const docxBuffer = await Packer.toBuffer(new Document({
    sections: [{ children: [new Paragraph('RefFlow Word fixture'), new Paragraph('Copy and edit this text.')] }]
  }));
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Budget');
  worksheet.getCell('A1').value = 'Category';
  worksheet.getCell('B1').value = 'Amount';
  worksheet.getCell('A2').value = 'Design';
  worksheet.getCell('B2').value = 42;
  const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const pdfBuffer = makePdf('Selectable PDF text');
  const downloadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'refflow-office-ui-'));

  const viteEntry = path.resolve(__dirname, '..', 'node_modules', 'vite', 'bin', 'vite.js');
  const server = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: path.resolve(__dirname, '..'),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverOutput = '';
  server.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
  server.stderr.on('data', chunk => { serverOutput += chunk.toString(); });

  let browser;
  try {
    try {
      await waitForServer();
    } catch (error) {
      throw new Error(`${error.message}\n${serverOutput.trim()}`);
    }
    browser = await puppeteer.launch({ headless: true });
    await browser.defaultBrowserContext().overridePermissions(ORIGIN, ['clipboard-read', 'clipboard-write']);
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1 });
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDirectory });
    const pageErrors = [];
    const consoleErrorPromises = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') {
        consoleErrorPromises.push(Promise.all(message.args().map(argument => argument.jsonValue().catch(() => String(argument))))
          .then(values => values.length ? values : [message.text()]));
      }
    });
    await page.goto(ORIGIN, { waitUntil: 'networkidle0' });
    const consoleCounts = { afterLoad: consoleErrorPromises.length };
    await page.waitForSelector('[data-empty-board-prompt]');
    await page.click('button[aria-label="Close start board menu"]');
    await page.waitForFunction(() => !document.querySelector('[data-empty-board-prompt]'));
    assert.ok(await page.$('.floating-pill'), 'Closing the welcome menu should leave the pill available.');
    consoleCounts.afterWelcomeDismiss = consoleErrorPromises.length;

    const dragWindowTo = async (windowElement, dragElement, targetX, targetY, options = {}) => {
      const { alt = false, duringDrag } = options;
      const windowBox = await windowElement.boundingBox();
      const dragBox = await dragElement.boundingBox();
      assert.ok(windowBox && dragBox, 'The floating window and drag surface must be visible.');

      const pointerX = dragBox.x + (dragBox.width / 2);
      const pointerY = dragBox.y + (dragBox.height / 2);
      const offsetX = pointerX - windowBox.x;
      const offsetY = pointerY - windowBox.y;
      let isMouseDown = false;

      if (alt) await page.keyboard.down('Alt');
      try {
        await page.mouse.move(pointerX, pointerY);
        await page.mouse.down();
        isMouseDown = true;
        await page.mouse.move(targetX + offsetX, targetY + offsetY, { steps: 8 });
        await new Promise(resolve => setTimeout(resolve, 80));
        if (duringDrag) await duringDrag();
      } finally {
        if (isMouseDown) await page.mouse.up();
        if (alt) await page.keyboard.up('Alt');
      }
      await new Promise(resolve => setTimeout(resolve, 180));
      return windowElement.boundingBox();
    };

    await page.evaluate(({ docx, xlsx, pdf }) => {
      const toBytes = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([toBytes(docx)], 'sample.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      transfer.items.add(new File([toBytes(xlsx)], 'sample.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      transfer.items.add(new File([toBytes(pdf)], 'sample.pdf', { type: 'application/pdf' }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, clientX: 520, clientY: 180, bubbles: true, cancelable: true }));
    }, { docx: docxBuffer.toString('base64'), xlsx: xlsxBuffer.toString('base64'), pdf: pdfBuffer.toString('base64') });

    await page.waitForSelector('textarea[aria-label="Editable Word document text"]', { timeout: 20_000 });
    await page.waitForSelector('input[aria-label="Budget cell A1"]', { timeout: 20_000 });
    await page.waitForSelector('.pdf-text-layer span', { timeout: 20_000 });
    await page.waitForSelector('[data-pill-preview-type="pdf"][data-pill-label="sample.pdf"] [data-preview-status="ready"]', { timeout: 20_000 });
    await page.waitForSelector('[data-pill-preview-type="docx"][data-pill-label="sample.docx"] [data-preview-status="ready"]', { timeout: 20_000 });
    await page.waitForSelector('[data-pill-preview-type="xlsx"][data-pill-label="sample.xlsx"] [data-preview-status="ready"]', { timeout: 20_000 });
    await page.waitForFunction(() => {
      const docxPreview = document.querySelector('[data-pill-preview-type="docx"]');
      const xlsxPreview = document.querySelector('[data-pill-preview-type="xlsx"]');
      return docxPreview?.textContent?.includes('RefFlow Word fixture') && xlsxPreview?.textContent?.includes('Category');
    }, { timeout: 20_000 });
    const pillDocumentPreviews = await page.$$eval('[data-pill-preview-type="pdf"], [data-pill-preview-type="docx"], [data-pill-preview-type="xlsx"]', elements => elements.map(element => ({
      type: element.getAttribute('data-pill-preview-type'),
      label: element.getAttribute('data-pill-label'),
      hasCanvas: Boolean(element.querySelector('canvas')),
      text: element.textContent
    })));
    assert.deepStrictEqual(pillDocumentPreviews.map(preview => preview.label).sort(), ['sample.docx', 'sample.pdf', 'sample.xlsx']);
    assert.ok(pillDocumentPreviews.find(preview => preview.type === 'pdf')?.hasCanvas, 'PDF pill items should render a first-page preview.');
    consoleCounts.afterOfficeLoad = consoleErrorPromises.length;

    const initialDocxText = await page.$eval('textarea[aria-label="Editable Word document text"]', element => element.value);
    assert.match(initialDocxText, /RefFlow Word fixture/);
    const initialCell = await page.$eval('input[aria-label="Budget cell A1"]', element => element.value);
    assert.strictEqual(initialCell, 'Category');
    const pdfText = await page.$eval('.pdf-text-layer', element => element.textContent);
    assert.match(pdfText, /Selectable PDF text/);

    const documentControls = await page.evaluate(() => {
      const pdfWindow = document.querySelector('.pdf-text-layer')?.closest('.floating-window');
      const docxWindow = document.querySelector('textarea[aria-label="Editable Word document text"]')?.closest('.floating-window');
      const xlsxWindow = document.querySelector('input[aria-label="Budget cell A1"]')?.closest('.floating-window');
      const resizeFrame = windowElement => ({
        edges: Array.from(windowElement?.querySelectorAll('[data-resize-edge]') || []).map(element => element.getAttribute('data-resize-edge')).sort(),
        visibleGripCount: windowElement?.querySelectorAll('[data-visible-resize-grip]').length || 0
      });
      return {
        pdfResetLabel: pdfWindow?.querySelector('[data-control="reset-view"]')?.textContent?.trim(),
        pdfHasRotate: Boolean(pdfWindow?.querySelector('[data-control="rotate"]')),
        docxHasRotate: Boolean(docxWindow?.querySelector('[data-control="rotate"]')),
        xlsxHasRotate: Boolean(xlsxWindow?.querySelector('[data-control="rotate"]')),
        resizeFrames: [resizeFrame(pdfWindow), resizeFrame(docxWindow), resizeFrame(xlsxWindow)]
      };
    });
    assert.strictEqual(documentControls.pdfResetLabel, 'Reset');
    assert.strictEqual(documentControls.pdfHasRotate, false, 'PDF windows should not show rotate.');
    assert.strictEqual(documentControls.docxHasRotate, false, 'DOCX windows should not show rotate.');
    assert.strictEqual(documentControls.xlsxHasRotate, false, 'XLSX windows should not show rotate.');
    const expectedResizeEdges = ['bottom', 'bottom-left', 'bottom-right', 'left', 'right', 'top', 'top-left', 'top-right'];
    documentControls.resizeFrames.forEach(frame => {
      assert.deepStrictEqual(frame.edges, expectedResizeEdges, 'Every media type should expose one hit zone for every edge and corner.');
      assert.strictEqual(frame.visibleGripCount, 0, 'Media resize hit zones should have no visible grip graphics.');
    });

    await page.$eval('textarea[aria-label="Editable Word document text"]', element => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(element, `${element.value.trim()}\nEdited inside RefFlow.`);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.$eval('input[aria-label="Budget cell A1"]', element => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(element, 'Edited Category');
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await new Promise(resolve => setTimeout(resolve, 700));

    const docxWindow = await page.$('textarea[aria-label="Editable Word document text"]');
    const docxWindowHandle = await docxWindow.evaluateHandle(element => element.closest('.floating-window'));
    await docxWindowHandle.asElement().evaluate(windowElement => { windowElement.style.zIndex = '999999'; });
    const docxMoveHandle = await docxWindowHandle.asElement().$('[data-office-drag-handle]');
    const docxMoveHandleBox = await docxMoveHandle.boundingBox();
    const docxMoveStart = await docxWindowHandle.asElement().boundingBox();
    await page.keyboard.down('Alt');
    await page.mouse.move(docxMoveHandleBox.x + 8, docxMoveHandleBox.y + (docxMoveHandleBox.height / 2));
    await page.mouse.down();
    await page.mouse.move(docxMoveHandleBox.x + 88, docxMoveHandleBox.y + 65, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await new Promise(resolve => setTimeout(resolve, 150));
    const docxMoveEnd = await docxWindowHandle.asElement().boundingBox();
    assert.ok(Math.abs(docxMoveEnd.x - docxMoveStart.x) > 50 || Math.abs(docxMoveEnd.y - docxMoveStart.y) > 35, 'The DOCX inner header should recover window dragging when the outer toolbar is covered.');

    const docxBottomResize = await docxWindowHandle.asElement().$('[data-resize-edge="bottom"]');
    const docxBottomResizeBox = await docxBottomResize.boundingBox();
    const docxResizeStart = await docxWindowHandle.asElement().boundingBox();
    await page.mouse.move(docxBottomResizeBox.x + (docxBottomResizeBox.width / 2), docxBottomResizeBox.y + 4);
    await page.mouse.down();
    await page.mouse.move(docxBottomResizeBox.x + (docxBottomResizeBox.width / 2), docxBottomResizeBox.y + 94, { steps: 6 });
    await page.mouse.up();
    await new Promise(resolve => setTimeout(resolve, 150));
    const docxResizeEnd = await docxWindowHandle.asElement().boundingBox();
    assert.ok(docxResizeEnd.height - docxResizeStart.height > 70, 'DOCX windows should resize vertically from the bottom edge.');
    assert.ok(Math.abs(docxResizeEnd.width - docxResizeStart.width) < 4, 'Bottom-only DOCX resize should preserve width.');

    const docxSaveButton = await docxWindowHandle.asElement().$('button[title="Save edited .docx file"]');
    await docxSaveButton.evaluate(button => button.click());
    const savedDocxPath = path.join(downloadDirectory, 'sample.docx');
    try {
      await waitForFile(savedDocxPath);
    } catch (error) {
      const diagnostics = await docxWindowHandle.asElement().evaluate(element => ({
        text: element.innerText,
        saveButtonText: element.querySelector('button[title="Save edited .docx file"]')?.innerText
      }));
      const consoleErrors = await Promise.all(consoleErrorPromises);
      throw new Error(`${error.message}\n${JSON.stringify({ diagnostics, pageErrors, consoleErrors }, null, 2)}`);
    }
    const savedDocxText = await mammoth.extractRawText({ path: savedDocxPath });
    assert.match(savedDocxText.value, /Edited inside RefFlow/);

    const xlsxCell = await page.$('input[aria-label="Budget cell A1"]');
    const xlsxWindowHandle = await xlsxCell.evaluateHandle(element => element.closest('.floating-window'));
    await xlsxWindowHandle.asElement().evaluate(windowElement => { windowElement.style.zIndex = '999999'; });
    const xlsxMoveHandle = await xlsxWindowHandle.asElement().$('[data-office-drag-handle]');
    const xlsxMoveHandleBox = await xlsxMoveHandle.boundingBox();
    const xlsxMoveStart = await xlsxWindowHandle.asElement().boundingBox();
    await page.keyboard.down('Alt');
    await page.mouse.move(xlsxMoveHandleBox.x + 8, xlsxMoveHandleBox.y + (xlsxMoveHandleBox.height / 2));
    await page.mouse.down();
    await page.mouse.move(xlsxMoveHandleBox.x - 72, xlsxMoveHandleBox.y + 70, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await new Promise(resolve => setTimeout(resolve, 150));
    const xlsxMoveEnd = await xlsxWindowHandle.asElement().boundingBox();
    assert.ok(Math.abs(xlsxMoveEnd.x - xlsxMoveStart.x) > 50 || Math.abs(xlsxMoveEnd.y - xlsxMoveStart.y) > 35, 'The XLSX inner header should recover window dragging when the outer toolbar is covered.');

    const xlsxCornerResize = await xlsxWindowHandle.asElement().$('[data-resize-edge="bottom-right"]');
    const xlsxCornerResizeBox = await xlsxCornerResize.boundingBox();
    const xlsxResizeStart = await xlsxWindowHandle.asElement().boundingBox();
    await page.mouse.move(xlsxCornerResizeBox.x + 8, xlsxCornerResizeBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(xlsxCornerResizeBox.x + 98, xlsxCornerResizeBox.y + 88, { steps: 6 });
    await page.mouse.up();
    await new Promise(resolve => setTimeout(resolve, 150));
    const xlsxResizeEnd = await xlsxWindowHandle.asElement().boundingBox();
    assert.ok(xlsxResizeEnd.width - xlsxResizeStart.width > 70, 'XLSX windows should resize horizontally from a bottom corner.');
    assert.ok(xlsxResizeEnd.height - xlsxResizeStart.height > 60, 'XLSX windows should resize vertically from a bottom corner.');

    const xlsxSaveButton = await xlsxWindowHandle.asElement().$('button[title="Save edited .xlsx file"]');
    await xlsxSaveButton.evaluate(button => button.click());
    const savedXlsxPath = path.join(downloadDirectory, 'sample.xlsx');
    await waitForFile(savedXlsxPath);
    const savedWorkbook = new ExcelJS.Workbook();
    await savedWorkbook.xlsx.readFile(savedXlsxPath);
    assert.strictEqual(savedWorkbook.getWorksheet('Budget').getCell('A1').value, 'Edited Category');

    await docxWindowHandle.asElement().evaluate(windowElement => { windowElement.style.zIndex = '999999'; });
    await page.evaluate(() => {
      window.__refflowCopiedText = '';
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: async text => { window.__refflowCopiedText = text; }
      });
    });
    const docxCopyButton = await docxWindowHandle.asElement().$('button[title="Copy all document text"]');
    await docxCopyButton.click();
    await new Promise(resolve => setTimeout(resolve, 200));
    const copiedDocxText = await page.evaluate(() => window.__refflowCopiedText);
    assert.match(copiedDocxText, /Edited inside RefFlow/);

    const copySelectionFromContextMenu = async expectedText => {
      await page.waitForSelector('button[data-document-context-copy]:not([disabled])');
      await page.$eval('button[data-document-context-copy]', button => button.click());
      await page.waitForFunction(() => !document.querySelector('button[data-document-context-copy]'));
      const copiedText = await page.evaluate(() => window.__refflowCopiedText);
      assert.strictEqual(copiedText, expectedText);
    };

    const selectedDocxText = await page.$eval('textarea[aria-label="Editable Word document text"]', element => {
      const expected = 'RefFlow Word fixture';
      const start = element.value.indexOf(expected);
      element.focus();
      element.setSelectionRange(start, start + expected.length);
      window.__refflowCopiedText = '';
      element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 720, clientY: 360 }));
      return expected;
    });
    await copySelectionFromContextMenu(selectedDocxText);

    const selectedXlsxText = await page.$eval('input[aria-label="Budget cell A1"]', element => {
      const expected = element.value;
      element.focus();
      element.setSelectionRange(0, expected.length);
      window.__refflowCopiedText = '';
      element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 780, clientY: 390 }));
      return expected;
    });
    await copySelectionFromContextMenu(selectedXlsxText);

    const selectedPdfText = await page.$eval('.pdf-text-layer span', element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      window.__refflowCopiedText = '';
      element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 820, clientY: 420 }));
      return selection.toString();
    });
    assert.ok(selectedPdfText.length > 0, 'PDF text should be selectable.');
    await copySelectionFromContextMenu(selectedPdfText);

    const pdfWindowHandle = await page.$('.pdf-text-layer');
    const pdfFloatingWindow = await pdfWindowHandle.evaluateHandle(element => element.closest('.floating-window'));
    await pdfFloatingWindow.asElement().evaluate(windowElement => { windowElement.style.zIndex = '999999'; });
    const pdfTopLeftResize = await pdfFloatingWindow.asElement().$('[data-resize-edge="top-left"]');
    const pdfTopLeftResizeBox = await pdfTopLeftResize.boundingBox();
    const pdfResizeStart = await pdfFloatingWindow.asElement().boundingBox();
    await page.mouse.move(pdfTopLeftResizeBox.x + 8, pdfTopLeftResizeBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(pdfTopLeftResizeBox.x - 62, pdfTopLeftResizeBox.y - 52, { steps: 6 });
    await page.mouse.up();
    await new Promise(resolve => setTimeout(resolve, 200));
    const pdfResizeEnd = await pdfFloatingWindow.asElement().boundingBox();
    assert.ok(pdfResizeEnd.x < pdfResizeStart.x - 45, 'PDF windows should resize from the left edge of a top-left corner.');
    assert.ok(pdfResizeEnd.y < pdfResizeStart.y - 35, 'PDF windows should resize from the top edge of a top-left corner.');
    assert.ok(pdfResizeEnd.width > pdfResizeStart.width + 45, 'Top-left PDF resizing should increase width when dragged outward.');
    assert.ok(pdfResizeEnd.height > pdfResizeStart.height + 35, 'Top-left PDF resizing should increase height when dragged outward.');
    consoleCounts.afterDocumentChecks = consoleErrorPromises.length;

    await page.click('button[title="Settings"]');
    await page.waitForSelector('button[title="Manage no-key search sources"]');
    const mainSettingsProviderCards = await page.$$eval('.settings-panel [data-provider]', elements => elements.length);
    assert.strictEqual(mainSettingsProviderCards, 0, 'Provider cards should not lengthen the main Settings menu.');
    await page.click('button[title="Manage no-key search sources"]');
    await page.waitForSelector('[data-settings-section="providers"]');
    const providerMenuState = await page.$eval('[data-settings-section="providers"]', element => ({
      providerCards: element.querySelectorAll('[data-provider]').length,
      providers: Array.from(element.querySelectorAll('[data-provider]')).map(card => card.getAttribute('data-provider')).sort(),
      hasShortcutEditor: Boolean(element.querySelector('input[aria-label="Minimize/Expand pill shortcut"]')),
      hasApiKeyField: Boolean(element.querySelector('#provider-api-key-input')),
      configureButtons: Array.from(element.querySelectorAll('button')).filter(button => /configure/i.test(button.textContent || '')).length
    }));
    assert.strictEqual(providerMenuState.providerCards, 2);
    assert.deepStrictEqual(providerMenuState.providers, ['Openverse', 'Wikimedia Commons']);
    assert.strictEqual(providerMenuState.hasApiKeyField, false, 'No API-key controls should remain in Search Providers.');
    assert.strictEqual(providerMenuState.configureButtons, 0, 'No provider should expose API configuration.');
    assert.strictEqual(providerMenuState.hasShortcutEditor, false, 'Search Providers should have its own focused menu.');
    await page.click('button[title="Back to Settings"]');
    await page.waitForSelector('input[aria-label="Minimize/Expand pill shortcut"]');
    const shortcutLayout = await page.$eval('.settings-panel', panel => {
      const panelRect = panel.getBoundingClientRect();
      const rows = Array.from(panel.querySelectorAll('[data-shortcut-row]')).map(row => {
        const labelRect = row.querySelector('[data-shortcut-label]').getBoundingClientRect();
        const controlsRect = row.querySelector('[data-shortcut-controls]').getBoundingClientRect();
        return { labelRight: labelRect.right, controlsLeft: controlsRect.left };
      });
      return { width: panel.offsetWidth, visualWidth: panelRect.width, rows };
    });
    assert.ok(shortcutLayout.width >= 315, `Settings panel should be wide enough for shortcut controls (${shortcutLayout.width}px).`);
    assert.ok(shortcutLayout.rows.every(row => row.labelRight <= row.controlsLeft + 0.5), 'Shortcut labels should never overlap their assignment controls.');
    const browserStartupStatus = await page.$eval('[data-start-on-boot-status]', element => element.textContent.trim());
    assert.match(browserStartupStatus, /packaged Windows app/i);
    const shortcutInput = await page.$('input[aria-label="Minimize/Expand pill shortcut"]');
    await shortcutInput.focus();
    await page.keyboard.down('Shift');
    await page.keyboard.press('M');
    await page.keyboard.up('Shift');
    const recordedShortcut = await page.evaluate(() => JSON.parse(localStorage.getItem('ref-flow-shortcuts') || '{}').minimize);
    assert.strictEqual(recordedShortcut, 'shift+m');
    await shortcutInput.press('Backspace');
    const disabledShortcut = await page.evaluate(() => JSON.parse(localStorage.getItem('ref-flow-shortcuts') || '{}').minimize);
    assert.strictEqual(disabledShortcut, '');
    consoleCounts.afterShortcuts = consoleErrorPromises.length;

    await page.click('button[title="Settings"]');
    await page.click('button[title="Add Floating Note"]');
    await page.waitForSelector('.floating-window[data-window-kind="note"] [data-note-resize-handle]');
    const noteWindow = await page.$('.floating-window[data-window-kind="note"]');
    await noteWindow.evaluate(windowElement => { windowElement.style.zIndex = '999999'; });
    const noteResizeFrame = await noteWindow.evaluate(windowElement => ({
      edges: Array.from(windowElement.querySelectorAll('[data-resize-edge]')).map(element => element.getAttribute('data-resize-edge')).sort(),
      visibleGripCount: windowElement.querySelectorAll('[data-visible-resize-grip]').length,
      frameCount: windowElement.querySelectorAll('[data-invisible-resize-frame="note"]').length
    }));
    assert.deepStrictEqual(noteResizeFrame.edges, expectedResizeEdges, 'Notes should expose all eight invisible resize zones.');
    assert.strictEqual(noteResizeFrame.visibleGripCount, 0, 'Note resize zones should have no visible grip graphics.');
    assert.strictEqual(noteResizeFrame.frameCount, 1, 'Notes should use one resize frame without duplicate handles.');

    const noteDragSpace = await noteWindow.$('[data-note-drag-space]');
    const noteDragSpaceBox = await noteDragSpace.boundingBox();
    const noteDragStart = await noteWindow.boundingBox();
    await page.keyboard.down('Alt');
    await page.mouse.move(noteDragSpaceBox.x + (noteDragSpaceBox.width / 2), noteDragSpaceBox.y + (noteDragSpaceBox.height / 2));
    await page.mouse.down();
    await page.mouse.move(noteDragSpaceBox.x + 88, noteDragSpaceBox.y + 68, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await new Promise(resolve => setTimeout(resolve, 150));
    const noteDragEnd = await noteWindow.boundingBox();
    assert.ok(noteDragEnd.x - noteDragStart.x > 55 && noteDragEnd.y - noteDragStart.y > 35, 'Empty note toolbar space should move the note reliably.');

    const noteSnapEnd = await dragWindowTo(noteWindow, noteDragSpace, 13, 45, {
      duringDrag: async () => {
        await page.waitForSelector('[data-window-snap-guide="x"]');
        await page.waitForSelector('[data-window-snap-guide="y"]');
      }
    });
    assert.ok(Math.abs(noteSnapEnd.x - 8) < 2, 'Notes should snap to the screen left edge with the configured gap.');
    assert.ok(Math.abs(noteSnapEnd.y - 40) < 2, 'Notes should include their toolbar when snapping to the screen top edge.');

    const noteAltBypassEnd = await dragWindowTo(noteWindow, noteDragSpace, 14, 46, {
      alt: true,
      duringDrag: async () => {
        const guideCount = await page.$$eval('[data-window-snap-guide]', elements => elements.length);
        assert.strictEqual(guideCount, 0, 'Holding Alt should temporarily bypass note snapping.');
      }
    });
    assert.ok(Math.abs(noteAltBypassEnd.x - 14) < 2 && Math.abs(noteAltBypassEnd.y - 46) < 2, 'Alt should preserve the unsnapped note position.');
    await dragWindowTo(noteWindow, noteDragSpace, 900, 220, { alt: true });

    const toolbarState = await noteWindow.evaluate(element => ({
      opacity: Number.parseFloat(getComputedStyle(element.querySelector('.note-toolbar')).opacity),
      formatControlCount: element.querySelectorAll('[data-note-format]').length,
      resizeMode: element.querySelector('[data-note-resize-mode]')?.textContent?.trim()
    }));
    assert.ok(toolbarState.opacity > 0.9, 'The active note toolbar should remain visible.');
    assert.strictEqual(toolbarState.formatControlCount, 3, 'Note formatting controls should keep a stable layout.');
    assert.strictEqual(toolbarState.resizeMode, 'Free');

    const editNoteButton = await noteWindow.$('button[title="Edit Markdown"]');
    await editNoteButton.click();
    await page.waitForFunction(() => Boolean(document.querySelector('.floating-window[data-window-kind="note"] button[title="Preview Markdown"]')));
    await noteWindow.$eval('textarea[placeholder^="Type a note"]', element => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(element, 'Weekly layout note');
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('[data-pill-preview-type="note"]')?.textContent?.includes('Weekly layout note'));
    const notePillLabel = await page.$eval('[data-pill-preview-type="note"]', element => element.getAttribute('data-pill-label'));
    assert.strictEqual(notePillLabel, 'Note 1');
    const previewNoteButton = await noteWindow.$('button[title="Preview Markdown"]');
    await previewNoteButton.click();
    const controlsAfterPreview = await noteWindow.$$eval('[data-note-format]', elements => elements.length);
    assert.strictEqual(controlsAfterPreview, 3, 'Formatting buttons should not disappear after switching note modes.');

    const pinNoteButton = await noteWindow.$('button[title="Pin to Background"]');
    await pinNoteButton.click();
    await page.waitForFunction(() => Boolean(document.querySelector('.floating-window[data-window-kind="note"] button[title="Unpin Note"]')));
    const controlsWhilePinned = await noteWindow.evaluate(element => ({
      formatControlCount: element.querySelectorAll('[data-note-format]').length,
      colorControlCount: element.querySelectorAll('button[title="Unlock note to change color"]').length,
      opacity: Number.parseFloat(getComputedStyle(element.querySelector('.note-toolbar')).opacity)
    }));
    assert.strictEqual(controlsWhilePinned.formatControlCount, 3);
    assert.strictEqual(controlsWhilePinned.colorControlCount, 5);
    assert.ok(controlsWhilePinned.opacity > 0.9, 'Pinning a note should not hide its active toolbar.');
    const unpinNoteButton = await noteWindow.$('button[title="Unpin Note"]');
    await unpinNoteButton.click();
    await page.waitForFunction(() => Boolean(document.querySelector('.floating-window[data-window-kind="note"] [data-note-resize-handle]')));

    const noteTopLeftHandle = await noteWindow.$('[data-resize-edge="top-left"]');
    const noteTopLeftBox = await noteTopLeftHandle.boundingBox();
    const noteTopLeftStart = await noteWindow.boundingBox();
    await page.mouse.move(noteTopLeftBox.x + 8, noteTopLeftBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(noteTopLeftBox.x - 52, noteTopLeftBox.y - 42, { steps: 5 });
    await page.mouse.up();
    await new Promise(resolve => setTimeout(resolve, 150));
    const noteTopLeftEnd = await noteWindow.boundingBox();
    assert.ok(noteTopLeftEnd.x < noteTopLeftStart.x - 40 && noteTopLeftEnd.y < noteTopLeftStart.y - 30, 'Notes should resize outward from their top-left corner.');
    assert.ok(noteTopLeftEnd.width > noteTopLeftStart.width + 40 && noteTopLeftEnd.height > noteTopLeftStart.height + 30, 'Top-left note resizing should update both dimensions.');

    const freeStart = await noteWindow.boundingBox();
    let noteResizeHandle = await noteWindow.$('[data-note-resize-handle]');
    let noteResizeBox = await noteResizeHandle.boundingBox();
    await page.mouse.move(noteResizeBox.x + noteResizeBox.width - 2, noteResizeBox.y + noteResizeBox.height - 2);
    await page.mouse.down();
    await page.mouse.move(noteResizeBox.x + noteResizeBox.width + 98, noteResizeBox.y + noteResizeBox.height + 18, { steps: 5 });
    await page.mouse.up();
    await new Promise(resolve => setTimeout(resolve, 250));
    const freeEnd = await noteWindow.boundingBox();
    assert.ok(freeEnd.width - freeStart.width > 80, 'Free note resize should change width independently.');
    assert.ok(freeEnd.height - freeStart.height < 45, 'Free note resize should not force proportional height.');

    const resizeModeButton = await noteWindow.$('[data-note-resize-mode]');
    await resizeModeButton.click();
    await page.waitForFunction(() => document.querySelector('.floating-window[data-window-kind="note"] [data-note-resize-mode]')?.textContent?.trim() === 'Ratio');
    const ratioStart = await noteWindow.boundingBox();
    noteResizeHandle = await noteWindow.$('[data-note-resize-handle]');
    noteResizeBox = await noteResizeHandle.boundingBox();
    await page.mouse.move(noteResizeBox.x + noteResizeBox.width - 2, noteResizeBox.y + noteResizeBox.height - 2);
    await page.mouse.down();
    await page.mouse.move(noteResizeBox.x + noteResizeBox.width + 78, noteResizeBox.y + noteResizeBox.height + 3, { steps: 5 });
    await page.mouse.up();
    await new Promise(resolve => setTimeout(resolve, 250));
    const ratioEnd = await noteWindow.boundingBox();
    assert.ok(Math.abs((ratioStart.width / ratioStart.height) - (ratioEnd.width / ratioEnd.height)) < 0.03, 'Ratio mode should preserve the note aspect ratio.');
    const closeNoteButton = await noteWindow.$('button[title="Close Note"]');
    await closeNoteButton.click();
    consoleCounts.afterNotes = consoleErrorPromises.length;

    await page.click('button[title="Add Floating Sketch"]');
    await page.waitForSelector('.floating-window[data-window-kind="sketch"] [data-sketch-resize-handle]');
    const sketchWindow = await page.$('.floating-window[data-window-kind="sketch"]');
    await sketchWindow.evaluate(windowElement => { windowElement.style.zIndex = '999999'; });
    const sketchResizeFrame = await sketchWindow.evaluate(windowElement => ({
      edges: Array.from(windowElement.querySelectorAll('[data-resize-edge]')).map(element => element.getAttribute('data-resize-edge')).sort(),
      visibleGripCount: windowElement.querySelectorAll('[data-visible-resize-grip]').length,
      frameCount: windowElement.querySelectorAll('[data-invisible-resize-frame="sketch"]').length
    }));
    assert.deepStrictEqual(sketchResizeFrame.edges, expectedResizeEdges, 'Sketches should expose all eight invisible resize zones.');
    assert.strictEqual(sketchResizeFrame.visibleGripCount, 0, 'Sketch resize zones should have no visible grip graphics.');
    assert.strictEqual(sketchResizeFrame.frameCount, 1, 'Sketches should use one resize frame without duplicate handles.');

    const sketchCanvas = await sketchWindow.$('canvas');
    const sketchCanvasBox = await sketchCanvas.boundingBox();
    await page.mouse.move(sketchCanvasBox.x + 70, sketchCanvasBox.y + 70);
    await page.mouse.down();
    await page.mouse.move(sketchCanvasBox.x + 145, sketchCanvasBox.y + 115, { steps: 6 });
    await page.mouse.up();
    await page.waitForSelector('[data-pill-preview-type="sketch"] svg path');
    const sketchPillLabel = await page.$eval('[data-pill-preview-type="sketch"]', element => element.getAttribute('data-pill-label'));
    assert.strictEqual(sketchPillLabel, 'Sketch 1');

    const sketchDragSpace = await sketchWindow.$('[data-sketch-drag-space]');
    const sketchDragSpaceBox = await sketchDragSpace.boundingBox();
    const sketchDragStart = await sketchWindow.boundingBox();
    await page.keyboard.down('Alt');
    await page.mouse.move(sketchDragSpaceBox.x + (sketchDragSpaceBox.width / 2), sketchDragSpaceBox.y + (sketchDragSpaceBox.height / 2));
    await page.mouse.down();
    await page.mouse.move(sketchDragSpaceBox.x + 78, sketchDragSpaceBox.y + 58, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await new Promise(resolve => setTimeout(resolve, 150));
    const sketchDragEnd = await sketchWindow.boundingBox();
    assert.ok(sketchDragEnd.x - sketchDragStart.x > 45 && sketchDragEnd.y - sketchDragStart.y > 25, 'Empty sketch toolbar space should move the sketch reliably.');

    const snapTargetBox = await docxWindowHandle.asElement().boundingBox();
    const sketchBeforeSnap = await sketchWindow.boundingBox();
    const rightSnapX = snapTargetBox.x + snapTargetBox.width + 8;
    const leftSnapX = snapTargetBox.x - sketchBeforeSnap.width - 8;
    const expectedSketchX = leftSnapX >= 8
      ? leftSnapX
      : rightSnapX;
    const expectedSketchY = snapTargetBox.y - 2;
    const sketchSnapEnd = await dragWindowTo(sketchWindow, sketchDragSpace, expectedSketchX + 2, expectedSketchY + 2, {
      duringDrag: async () => {
        await page.waitForSelector('[data-window-snap-guide="x"]');
        await page.waitForSelector('[data-window-snap-guide="y"]');
      }
    });
    assert.ok(
      Math.abs(sketchSnapEnd.x - expectedSketchX) < 2,
      `Sketches should snap beside neighboring document windows: ${JSON.stringify({ snapTargetBox, sketchBeforeSnap, expectedSketchX, expectedSketchY, sketchSnapEnd })}`
    );
    assert.ok(
      Math.abs(sketchSnapEnd.y - expectedSketchY) < 2,
      `Sketch and document toolbars should align while snapping: ${JSON.stringify({ snapTargetBox, sketchBeforeSnap, expectedSketchX, expectedSketchY, sketchSnapEnd })}`
    );
    await dragWindowTo(sketchWindow, sketchDragSpace, 900, 520, { alt: true });

    const sketchTopLeftHandle = await sketchWindow.$('[data-resize-edge="top-left"]');
    const sketchTopLeftBox = await sketchTopLeftHandle.boundingBox();
    const sketchResizeStart = await sketchWindow.boundingBox();
    await page.mouse.move(sketchTopLeftBox.x + 8, sketchTopLeftBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(sketchTopLeftBox.x - 62, sketchTopLeftBox.y - 52, { steps: 5 });
    await page.mouse.up();
    await new Promise(resolve => setTimeout(resolve, 150));
    const sketchResizeEnd = await sketchWindow.boundingBox();
    assert.ok(sketchResizeEnd.x < sketchResizeStart.x - 45 && sketchResizeEnd.y < sketchResizeStart.y - 35, 'Sketches should resize outward from their top-left corner.');
    assert.ok(sketchResizeEnd.width > sketchResizeStart.width + 45 && sketchResizeEnd.height > sketchResizeStart.height + 35, 'Top-left sketch resizing should update both dimensions.');
    const closeSketchButton = await sketchWindow.$('button[title="Close Sketch"]');
    await closeSketchButton.click();
    consoleCounts.afterSketches = consoleErrorPromises.length;

    await page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem;
      window.__pillPositionWriteStats = { writes: 0 };
      window.__restoreStorageSetItem = () => { Storage.prototype.setItem = originalSetItem; };
      Storage.prototype.setItem = function (key, value) {
        if (key === 'ref-flow-pill-position') window.__pillPositionWriteStats.writes++;
        return originalSetItem.call(this, key, value);
      };
    });
    const fastPillHandle = await page.$('.floating-pill .drag-handle');
    const fastPillHandleBox = await fastPillHandle.boundingBox();
    const fastPillStart = await page.$eval('.floating-pill', element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y };
    });
    const fastPillDragStartedAt = Date.now();
    await page.mouse.move(fastPillHandleBox.x + 8, fastPillHandleBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(fastPillHandleBox.x + 148, fastPillHandleBox.y + 98, { steps: 90 });
    await new Promise(resolve => setTimeout(resolve, 100));
    const pillDuringFastDrag = await page.evaluate(() => {
      const rect = document.querySelector('.floating-pill').getBoundingClientRect();
      return { x: rect.x, y: rect.y, writes: window.__pillPositionWriteStats.writes };
    });
    assert.ok(pillDuringFastDrag.x - fastPillStart.x > 110 && pillDuringFastDrag.y - fastPillStart.y > 65, 'Fast pill movement should track the latest pointer position.');
    assert.strictEqual(pillDuringFastDrag.writes, 0, 'Pill position should not rerender and persist the full workspace during mouse-move frames.');
    await page.mouse.up();
    await new Promise(resolve => setTimeout(resolve, 180));
    const fastPillStats = await page.evaluate(() => {
      const stats = { ...window.__pillPositionWriteStats };
      window.__restoreStorageSetItem();
      delete window.__restoreStorageSetItem;
      return stats;
    });
    const fastPillDragDuration = Date.now() - fastPillDragStartedAt;
    assert.ok(fastPillStats.writes <= 1, `Pill drag should commit at most once, but wrote ${fastPillStats.writes} times.`);
    assert.ok(fastPillDragDuration < 3500, `Fast pill drag took too long (${fastPillDragDuration} ms).`);

    const pillBefore = await page.$eval('.floating-pill', element => element.getBoundingClientRect().x);
    const pillHandle = await page.$('.floating-pill .drag-handle');
    const pillHandleBox = await pillHandle.boundingBox();
    await page.mouse.move(pillHandleBox.x + 8, pillHandleBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(pillHandleBox.x + 28, pillHandleBox.y + 18);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.up();
    const refreshedHandleBox = await pillHandle.boundingBox();
    await page.mouse.move(refreshedHandleBox.x + 8, refreshedHandleBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(refreshedHandleBox.x + 48, refreshedHandleBox.y + 18, { steps: 4 });
    await page.mouse.up();
    const pillAfter = await page.$eval('.floating-pill', element => element.getBoundingClientRect().x);
    assert.notStrictEqual(Math.round(pillAfter), Math.round(pillBefore), 'Pill should remain draggable after a lost-release recovery.');
    consoleCounts.afterPill = consoleErrorPromises.length;

    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=';
    await page.evaluate(({ png }) => {
      const bytes = Uint8Array.from(atob(png), character => character.charCodeAt(0));
      const transfer = new DataTransfer();
      for (let index = 0; index < 36; index++) {
        transfer.items.add(new File([bytes], `tiny-${index}.png`, { type: 'image/png' }));
      }
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, clientX: 760, clientY: 260, bubbles: true, cancelable: true }));
    }, { png: tinyPng });
    await page.waitForFunction(() => document.querySelectorAll('.floating-window[data-window-kind="image"]').length >= 39, { timeout: 20_000 });
    const imageWindow = await page.$('.floating-window[data-window-kind="image"]:has(img[alt="Floating Reference"])');
    const imageDragSpace = await imageWindow.$('[data-media-drag-space]');
    const imageControlState = await page.$eval('.floating-window[data-window-kind="image"]:has(img[alt="Floating Reference"])', element => ({
      hasRotate: Boolean(element.querySelector('[data-control="rotate"]')),
      resetLabel: element.querySelector('[data-control="reset-view"]')?.textContent?.trim()
    }));
    assert.strictEqual(imageControlState.hasRotate, true, 'Image windows should keep the rotate control.');
    assert.strictEqual(imageControlState.resetLabel, 'Reset');
    const imageStartBox = await imageWindow.boundingBox();
    const imageHandleBox = await imageDragSpace.boundingBox();
    const dragStartedAt = Date.now();
    await page.mouse.move(imageHandleBox.x + (imageHandleBox.width / 2), imageHandleBox.y + (imageHandleBox.height / 2));
    await page.mouse.down();
    await page.mouse.move(imageHandleBox.x + 180, imageHandleBox.y + 110, { steps: 30 });
    await page.mouse.up();
    const dragDuration = Date.now() - dragStartedAt;
    const imageEndBox = await imageWindow.boundingBox();
    assert.ok(Math.abs(imageEndBox.x - imageStartBox.x) > 80 || Math.abs(imageEndBox.y - imageStartBox.y) > 60, 'Empty media toolbar space should drag the window reliably.');
    assert.ok(dragDuration < 4000, `Many-window drag took too long (${dragDuration} ms).`);

    const mediaResizeInventory = await page.$$eval('.floating-window[data-window-kind="image"]', windows => windows.map(windowElement => ({
      edgeCount: windowElement.querySelectorAll('[data-resize-edge]').length,
      visibleGripCount: windowElement.querySelectorAll('[data-visible-resize-grip]').length
    })));
    assert.ok(mediaResizeInventory.every(frame => frame.edgeCount === 8), 'Every image, PDF, DOCX, and XLSX window should have all eight edge/corner resize zones.');
    assert.ok(mediaResizeInventory.every(frame => frame.visibleGripCount === 0), 'All media resize zones should remain visually invisible.');

    const imageCornerResize = await imageWindow.$('[data-resize-edge="bottom-right"]');
    const imageCornerResizeBox = await imageCornerResize.boundingBox();
    const imageResizeStart = await imageWindow.boundingBox();
    await page.mouse.move(imageCornerResizeBox.x + 8, imageCornerResizeBox.y + 8);
    await page.mouse.down();
    await page.mouse.move(imageCornerResizeBox.x + 88, imageCornerResizeBox.y + 78, { steps: 6 });
    await page.mouse.up();
    await new Promise(resolve => setTimeout(resolve, 150));
    const imageResizeEnd = await imageWindow.boundingBox();
    assert.ok(imageResizeEnd.width - imageResizeStart.width > 60, 'Image windows should resize horizontally from a corner.');
    assert.ok(imageResizeEnd.height - imageResizeStart.height > 55, 'Image windows should resize vertically from a corner.');
    consoleCounts.afterManyWindows = consoleErrorPromises.length;

    assert.deepStrictEqual(pageErrors, [], `Page errors: ${pageErrors.join('; ')}`);
    const consoleErrors = await Promise.all(consoleErrorPromises);
    const relevantConsoleErrors = consoleErrors.filter(values => !values.some(value => String(value).includes('Failed to load resource: the server responded with a status of 404')));
    const keyDiagnostics = await page.evaluate(() => {
      const ids = Array.from(document.querySelectorAll('.floating-window[data-id]')).map(element => element.getAttribute('data-id'));
      return {
        ids,
        duplicateIds: ids.filter((id, index) => ids.indexOf(id) !== index),
        emptyIds: ids.filter(id => !id).length
      };
    });
    assert.deepStrictEqual(relevantConsoleErrors, [], `Console errors: ${JSON.stringify({ consoleCounts, keyDiagnostics, uniqueErrors: [...new Map(relevantConsoleErrors.map(values => [JSON.stringify(values), values])).values()] }, null, 2)}`);

    const startupPage = await browser.newPage();
    await startupPage.evaluateOnNewDocument(() => {
      window.__startupEnabled = true;
      window.__startupInvokeCalls = [];
      localStorage.setItem('ref-flow-api-keys', JSON.stringify({ SerpAPI: 'legacy-key' }));
      localStorage.setItem('ref-flow-provider-order', JSON.stringify(['SerpAPI', 'Openverse', 'Pixabay', 'Wikimedia Commons']));
      const ipcRenderer = {
        invoke: async (channel, ...args) => {
          window.__startupInvokeCalls.push([channel, ...args]);
          if (channel === 'get-start-on-boot-status') {
            return {
              success: true,
              supported: true,
              enabled: window.__startupEnabled,
              requiresElevation: false,
              message: 'RefFlowStudio will start when you sign in to Windows.'
            };
          }
          if (channel === 'set-start-on-boot') {
            window.__startupEnabled = Boolean(args[0]);
            return {
              success: true,
              supported: true,
              enabled: window.__startupEnabled,
              requiresElevation: false,
              message: window.__startupEnabled ? 'Start on Boot enabled.' : 'Start on Boot disabled.'
            };
          }
          if (channel === 'get-default-data-directory') return '';
          if (channel === 'get-update-status') return { phase: 'development', message: 'Test mode' };
          if (channel === 'get-display-layout') return null;
          if (channel === 'get-launch-context') return { shouldRevealPill: true };
          if (channel === 'open-external-url') return true;
          return null;
        },
        send: () => {},
        on: () => {},
        removeListener: () => {}
      };
      Object.defineProperty(window, 'require', {
        configurable: true,
        value: moduleName => moduleName === 'electron' ? { ipcRenderer } : undefined
      });
    });
    await startupPage.goto(ORIGIN, { waitUntil: 'networkidle0' });
    await startupPage.click('button[title="Settings"]');
    await startupPage.waitForSelector('input[aria-label="Start on Boot"]:checked');
    const startupStatusBefore = await startupPage.$eval('[data-start-on-boot-status]', element => element.textContent.trim());
    assert.match(startupStatusBefore, /sign in to Windows/i);
    await startupPage.click('input[aria-label="Start on Boot"]');
    await startupPage.waitForFunction(() => !document.querySelector('input[aria-label="Start on Boot"]')?.checked);
    const startupCalls = await startupPage.evaluate(() => window.__startupInvokeCalls);
    assert.ok(startupCalls.some(call => call[0] === 'set-start-on-boot' && call[1] === false), 'Start on Boot should wait for confirmed IPC registration changes.');
    assert.strictEqual(await startupPage.evaluate(() => localStorage.getItem('ref-flow-api-keys')), null, 'The 1.0.6 migration should remove saved API keys.');
    const migratedProviders = await startupPage.evaluate(() => JSON.parse(localStorage.getItem('ref-flow-provider-order') || '[]').sort());
    assert.deepStrictEqual(migratedProviders, ['Openverse', 'Wikimedia Commons']);

    await startupPage.click('button[title="Settings"]');
    await startupPage.click('button[title="Quick Reference Search"]');
    await startupPage.waitForSelector('input[placeholder="Search images..."]');
    await startupPage.$$eval('button', buttons => {
      const googleButton = buttons.find(button => button.textContent?.trim() === 'Google Images');
      if (!googleButton) throw new Error('Google Images browser provider was not found.');
      googleButton.click();
    });
    await startupPage.type('input[placeholder="Search images..."]', 'reference poses');
    await startupPage.keyboard.press('Enter');
    await startupPage.waitForFunction(() => window.__startupInvokeCalls.some(call => call[0] === 'open-external-url'));
    const externalSearchCall = await startupPage.evaluate(() => window.__startupInvokeCalls.find(call => call[0] === 'open-external-url'));
    assert.match(externalSearchCall[1], /^https:\/\/www\.google\.com\/search\?/);
    await startupPage.close();

    console.log(JSON.stringify({
      docx: 'view/edit/copy/save passed',
      xlsx: 'view/edit/save passed',
      officeWindowMovement: 'DOCX and XLSX inner-header recovery dragging passed',
      officeWindowResize: 'bottom and bottom-corner resizing passed',
      pdf: 'selectable text and compact first-page preview passed',
      documentContextCopy: 'PDF, DOCX, and XLSX right-click copy passed',
      pillDocumentPreviews: 'PDF, DOCX, and XLSX content previews with filenames passed',
      welcomeMenu: 'dismissible empty-board welcome passed',
      universalMediaResize: 'all invisible edges and corners passed',
      shortcuts: 'custom modifier and unassign passed',
      shortcutLayout: 'wide non-overlapping settings layout passed',
      notes: 'stable controls, named pill preview, and free/proportional resize passed',
      noteMovement: 'empty toolbar drag surface, screen snapping, and Alt bypass passed',
      noteResizeFrame: 'all invisible edges and corners passed',
      sketches: 'drawn pill preview, movement, neighboring-window snapping, and all invisible resize edges/corners passed',
      documentControls: 'Reset label and rotate visibility passed',
      providerSettings: 'no-key provider migration and API-setting removal passed',
      externalBrowserSearch: 'browser providers route through Windows external URL IPC',
      startOnBoot: 'verified IPC status and confirmed toggle passed',
      pill: 'lost-release recovery and single-commit fast dragging passed',
      fastPillDragMs: fastPillDragDuration,
      mediaToolbarDrag: 'empty toolbar drag surface passed',
      manyWindowDragMs: dragDuration
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    server.kill();
    if (server.exitCode == null) {
      await new Promise(resolve => {
        server.once('exit', resolve);
        setTimeout(resolve, 3000);
      });
    }
    if (server.exitCode && server.exitCode !== 0) process.stderr.write(serverOutput);
    const safeTempPrefix = path.join(os.tmpdir(), 'refflow-office-ui-');
    if (path.resolve(downloadDirectory).startsWith(path.resolve(safeTempPrefix))) {
      fs.rmSync(downloadDirectory, { recursive: true, force: true });
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
