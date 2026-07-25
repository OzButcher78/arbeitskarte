// ============================================================================
// electron-builder config — Arbeitskarte (unsigned, no auto-update for v1)
// ----------------------------------------------------------------------------
// One .exe, per-user NSIS install. No publish channel yet — v1 is hand-
// distributed. Add a `publish` block + `npm run release` later if wanted.
//
// PER-USER ONLY, ON PURPOSE (`allowElevation: false`). With elevation allowed,
// the assisted installer offers "Für alle Benutzer", and picking it makes the
// ELEVATED installer try to remove the existing per-user copy
// (installSection.nsh: `uninstallOldVersion HKEY_CURRENT_USER` when
// installMode == "all"). When that hand-off fails it retries 5× and then shows
// "Arbeitskarte kann nicht geschlossen werden" — a misleading message, since
// the same string is reused in installUtil.nsh for "removing the old version
// failed", not just for "the app is running". Disabling elevation greys the
// option out, so the per-machine path can't be entered by accident.
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

    // Android-only, and actively harmful here. @capacitor/* are runtime deps
    // (for `npm run build:android`), so electron-builder packed them — and
    // because they carry .jar/.aar/.so, it put them in app.asar.UNPACKED, i.e.
    // as ~874 loose files on disk. @capacitor/android ships its whole Gradle
    // output (build/intermediates/**/*.class), whose paths reach 257 chars.
    // The uninstaller's un.atomicRMDir renames every file into $PLUGINSDIR
    // before deleting, which is a LONGER prefix — 17 files land at ≥260 chars.
    // NSIS is not longPathAware (the LongPathsEnabled=1 registry flag does not
    // apply to it), so those Renames fail, un.atomicRMDir aborts, and the
    // uninstaller exits 2 → "Die alten Anwendungsdateien konnten nicht
    // deinstalliert werden … : 2" during an upgrade.
    // Nothing needs them at runtime: dist-electron/main.cjs requires only
    // electron / electron-window-state / node builtins, and the renderer's
    // @capacitor/* imports are bundled into dist/assets by Vite (no bare
    // specifiers survive the build).
    '!node_modules/@capacitor${/*}',
  ],

  asar: true,

  win: {
    icon: 'build/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'Arbeitskarte-Setup-${version}.${ext}',
  },

  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'Arbeitskarte',
    deleteAppDataOnUninstall: false,
  },
};
