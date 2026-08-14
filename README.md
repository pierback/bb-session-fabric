# Session Fabric for BB

Session Fabric is the optional application layer for inspecting and operating
portable provider sessions in [Pierback BB](https://github.com/pierback/bb).
It contributes a thread panel, operator settings, and the `bb fabric` command.

## Requirements

- Pierback BB `0.36.x` containing the public `bb.sdk.sessionFabric` capability
  (core commit `1729682a3` or newer).
- BB Plugin SDK `0.4.x`.
- Node.js 22.19 or newer when installing from Git.

The plugin deliberately has no fallback for upstream BB builds that do not
provide Session Fabric. Runtime authority belongs to the compatible BB core.

## Install

Install the tracking `main` branch:

```bash
bb plugin install \
  git:https://github.com/pierback/bb-session-fabric.git@main \
  --yes
```

Then open **Session Fabric** from a thread's right-panel Actions list or run:

```text
bb fabric status [thread-id] [--json]
bb fabric connect [thread-id] [--json]
bb fabric command <command-id> [--json]
bb fabric handoff <transition-id> [--json --page <number> [--snapshot <sha256>]]
```

`handoff --json` returns a bounded summary. Add `--page <number>` to export
the complete audit as base64-encoded `application/json` pages. Page 1 captures
an immutable ten-minute snapshot and reports its `snapshot` token and
`pageCount`. Pass that token with `--snapshot` when requesting every later
page, then decode each page's `data` and concatenate the decoded bytes in page
order to recover the exact audit document. Every page stays below BB's plugin
CLI output limit. Snapshot retention is bounded to four active exports and 32
MiB cumulatively; an export that would exceed either limit is rejected without
invalidating any unexpired token. Capacity is released automatically at expiry,
and the bounded handoff summary remains available for audits that are too large
to export.

Check and apply updates with:

```bash
bb plugin outdated
bb plugin update session-fabric --yes
```

## Development

```bash
npm install
npm run check
bb plugin install .
bb plugin dev
```

`npm run build` first verifies that the `bb` executable on `PATH` exposes the
same SDK declarations checked into this repository, then produces
`dist/server.js` and the frontend bundle. It fails before changing `types/`
when an upstream or stale CLI is selected. Managed Git installations perform
the build with the target BB server's own toolchain.

The `types/` declarations are copied from the compatible Pierback BB SDK so
the repository typechecks independently. Refresh them after a core SDK change:

```bash
bb plugin types
```

Run that command with the Pierback BB executable, not an upstream build that
lacks `bb.sdk.sessionFabric`.

## Architectural boundary

This repository owns presentation, operator commands, and workflow-oriented
orchestration. It does **not** own:

- coordinator selection or authentication;
- execution-host enrollment or daemon lifecycle;
- runtime fencing and process identity;
- portable-session or worktree-migration semantics; or
- the canonical project execution-location badge.

Those are bootstrap and trust primitives in BB core. This plugin consumes only
the public `bb.sdk.sessionFabric` contract, owns its RPC projection, vendors its
UI primitives, and does not import BB server, daemon, database, or private
`/internal` implementations.
