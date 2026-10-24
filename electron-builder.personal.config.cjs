const base = require('./electron-builder.config.cjs');
const { platform } = require('node:process');

// Reproducible personal build; keep the application identity and existing data.
module.exports = {
    ...base,
    artifactName: 'Netcatty-${version}-${os}-${arch}.${ext}',
    extraMetadata: {
        version: '1.1.86-C1',
        homepage: 'https://github.com/caspar94/Netcatty',
    },
    directories: { ...base.directories, output: platform === 'darwin' ? 'release/personal' : 'release' },
    mac: { ...base.mac, identity: null, notarize: false },
    publish: [{ provider: 'github', owner: 'caspar94', repo: 'Netcatty', releaseType: 'release' }],
};
