const packageJson = require('../package.json');

const base = packageJson.build;
const skipWindowsSigning = async () => undefined;

module.exports = {
  ...base,
  win: {
    ...base.win,
    // Preserve RefFlow's executable icon and version resources, but skip the
    // Authenticode step while the public-preview certificate is pending.
    signAndEditExecutable: true,
    signtoolOptions: {
      ...(base.win.signtoolOptions || {}),
      sign: skipWindowsSigning
    }
  }
};
