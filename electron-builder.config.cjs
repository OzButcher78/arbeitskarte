// ============================================================================
// electron-builder config — Arbeitskarte (unsigned, no auto-update for v1)
// ----------------------------------------------------------------------------
// One .exe, per-user NSIS install. No publish channel yet — v1 is hand-
// distributed. Add a `publish` block + `npm run release` later if wanted.
// ============================================================================

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'ch.spritzwerkgrab.arbeitskarte',
  productName: 'Arbeitskarte',
  copyright: 'Copyright © 2026 Carrosserie Spritzwerk Grab GmbH',

  directories: {
    output: 'release',
    buildResources: 'build',
  },

  files: [
    'dist/**/*',
    'dist-electron/**/*',
    'package.json',
    '!**/*.map',
    '!**/{CHANGELOG.md,README.md,README,readme.md,readme}',
    '!dist/win-unpacked${/*}',
  ],

  asar: true,

  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'Arbeitskarte-Setup-${version}.${ext}',
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Arbeitskarte',
    deleteAppDataOnUninstall: false,
  },
};
