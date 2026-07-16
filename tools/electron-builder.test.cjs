const packageJson = require('../package.json');

const base = packageJson.build;

module.exports = {
  ...base,
  appId: 'com.refflow.studio.test',
  productName: 'RefFlowStudio Test',
  extraMetadata: {
    name: 'refflowstudio-test',
    productName: 'RefFlowStudio Test'
  },
  directories: {
    ...base.directories,
    output: 'dist_test'
  },
  publish: [],
  win: {
    ...base.win,
    signAndEditExecutable: false,
    artifactName: 'RefFlowStudio-Test-${version}-${arch}-Setup.${ext}'
  },
  nsis: {
    ...base.nsis,
    include: 'tools/installer.test.nsh',
    shortcutName: 'ReferenceFlow Test'
  }
};
