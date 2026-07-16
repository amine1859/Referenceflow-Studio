const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const installerArgument = process.argv[2];
if (!installerArgument) {
  console.error('Usage: npm run update:metadata -- <signed-installer.exe> [latest.yml]');
  process.exit(1);
}

const installerPath = path.resolve(installerArgument);
if (!fs.existsSync(installerPath) || !fs.statSync(installerPath).isFile()) {
  console.error(`Installer not found: ${installerPath}`);
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const fileName = path.basename(installerPath);
const expectedVersion = String(packageJson.version || '').trim();
if (!expectedVersion || !fileName.includes(expectedVersion)) {
  console.error(`Installer name must include package version ${expectedVersion || '(missing)'}.`);
  process.exit(1);
}

const installer = fs.readFileSync(installerPath);
const sha512 = crypto.createHash('sha512').update(installer).digest('base64');
const outputPath = path.resolve(process.argv[3] || path.join(path.dirname(installerPath), 'latest.yml'));
const quotedFileName = JSON.stringify(fileName);
const releaseDate = new Date().toISOString();
const metadata = [
  `version: ${expectedVersion}`,
  'files:',
  `  - url: ${quotedFileName}`,
  `    sha512: ${sha512}`,
  `    size: ${installer.length}`,
  '    isAdminRightsRequired: true',
  `path: ${quotedFileName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  ''
].join('\n');

fs.writeFileSync(outputPath, metadata, 'utf8');
console.log(`Wrote updater metadata for ${fileName} to ${outputPath}`);
