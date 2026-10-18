# Caspar94 personal build

Base release: Netcatty v1.1.84 (`9ce0b5958335e7addd3a6d980ee20e5dcfc526b9`).
Personal version: `1.1.84-C1`.
Repository: https://github.com/caspar94/Netcatty

## Retained optimizations

The following local improvements are not present in the upstream release:

- Coalesce terminal fit requests into one animation frame while preserving
  forced, immediate, and visibility recovery options.
- Subscribe the top tab bar to the host-tree toggle value rather than every
  active tab ID change; individual tabs retain their own active subscriptions.
- Memoize completed chat message bodies and activity groups during streaming.
- Defer parsing and rendering collapsed tool results until expansion, and
  retain unchanged result groups during subsequent streaming updates.
- Batch external SDK thinking and text deltas together, flushing at tool,
  steering, completion, error, and cancellation boundaries.
- Run Claude Keychain, Copilot auth, and Cursor CLI probes asynchronously so
  slow external processes do not block the desktop main process.

The upstream release's conversation forking and unavailable attachment
indicators are retained. Upstream SFTP, search, editor, and browser performance
improvements are also included.

## Build

Requires Node.js 22+ and macOS for the macOS packages.

```sh
npm ci
npm run pack:personal:mac
```

DMG and ZIP artifacts for Intel and Apple Silicon are written under
`release/personal/`. The dedicated config keeps the application identity for
existing Netcatty data, embeds the personal version, and points update metadata
to the personal fork. Packages use a local ad-hoc signature without a Developer ID certificate and
are not notarized. The command does
not publish a GitHub release.

## Checks

```sh
npm run lint
npm test
npm run test:terminal-background-rendering
npm run test:top-tabs-switch-performance
npm run test:agent-chat-performance
```

The last three commands require Electron and a graphical macOS session.

## Validation for 1.1.84-C1

- `npm ci` applied the release's updated dependency lock and SSH patches.
- ESLint: 0 errors (8 existing warnings); final changed-file check: clean.
- Full Node suite with concurrency 4 and a 60-second test deadline:
  14,048 passed, 42 skipped, 1 cancelled by timeout, 0 assertion failures.
  The cancelled upstream SFTP test is
  `a newer pause supersedes resume while concurrent writes are draining: settle=false`.
  It also timed out when run alone against an unmodified archive of v1.1.84
  using the same installed dependencies (15-second diagnostic deadline).
- Electron tab-switch regression passed: 60 switches, 2 tab-bar renders.
- Electron chat regression passed: no completed activity rerenders or completed
  tool artifact parses during 60 streaming updates; tool expansion and edits work.
- Electron terminal background-rendering regression passed, including rapid
  switches, alternate screen, and split layouts.

- Both macOS DMG/ZIP pairs built successfully; package metadata reports
  `1.1.84-C1` and the personal fork update source. Both DMG checksums verified.
- The packaged Intel app launched with an isolated temporary profile, stayed
  running for 15 seconds, and exited cleanly. Apple Silicon was cross-built
  and its binary architecture checked; it was not launched on this Intel host.
- SHA-256 checksums are available in `release/personal/SHA256SUMS`.
