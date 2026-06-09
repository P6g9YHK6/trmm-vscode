## 0.21.0
2026-06-09

- Add OpenVSX publishing with toggle (disabled), parallel publish, download vsix artifact

2026-06-09

- Fix vsce deprecation, add verbose logging to changelog script

2026-06-09

- Overhaul CI/CD error handling: retries, fallbacks, validation, concurrency

2026-06-09

- Opt into Node 24 actions via FORCE_JAVASCRIPT_ACTIONS_TO_NODE24

2026-06-09

- Fix push: use --autostash to handle unstaged changes from vsce
- Bump actions to @v5 (Node 24-compatible)
- Fix CI push: pull --rebase before pushing to avoid non-fast-forward

2026-06-09

- Fix all @typescript-eslint/no-explicit-any warnings and metadata variable shadowing bug


## 0.1.0

- Pull/push/sync scripts between TRMM API and local folder
- Test scripts on remote agents
- Edit metadata inline (quick-pick)
- Auto-push on save
- Multi-instance ID tracking (hash-based)
- CLI mode for cron/CI
- Esbuild bundling
