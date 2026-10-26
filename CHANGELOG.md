# Changelog

All notable changes to GitDeck are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/).

## [1.1.0] — 2026-10-26

### Added

- Push current branch from the repository header.
- First-push flow that selects a remote and automatically sets the upstream branch (`git push --set-upstream`).
- Ahead-count indicator on the push button and automatic repository refresh after a successful push.
- Remote list in repository summaries, with credential-redacted URLs.
- Dedicated publish modal with remote selection and inline push errors.
- Push API endpoint (`POST /api/repos/:id/push`).
- Backend integration test for first-push and subsequent-push flows.

### Changed

- Remote fetch and push output is sanitized to avoid exposing credentials embedded in remote URLs.
- Documentation updated with push workflows, supported operations, troubleshooting and security notes.

## [1.0.0] — 2026-10-26

### Added

- Multi-repository workspace with add, switch, remove and live repository summaries.
- Local changes view with staged / unstaged / untracked / conflict groups.
- File-level stage, unstage, discard and bulk actions.
- Commit composer with multi-line messages, amend support and `Ctrl+Enter`.
- Side-by-side and unified diff views with word-level change highlighting, full-context expansion and patch copying.
- Commit history with current-branch / all-branches filters, search, tags, remote refs and merge markers.
- Commit details with author metadata, changed-file statistics and per-file commit diffs.
- File history with rename following, parent-version diffs, comparison against the working tree, arbitrary two-version comparison and historical file snapshots.
- Branch switcher with branch search, local checkout, new branch creation and remote-branch tracking.
- Remote fetch (`git fetch --all --prune`).
- Command palette, dark / light themes, toasts, empty states and keyboard shortcuts.
- Express API bound to loopback with a React 19 + Vite frontend.
- Demo repository generator for local exploration.
- Backend integration tests and a GitHub Actions CI workflow.

[1.1.0]: https://github.com/wood3304/gitdeck/releases/tag/v1.1.0
[1.0.0]: https://github.com/wood3304/gitdeck/releases/tag/v1.0.0
