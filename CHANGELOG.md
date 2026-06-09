# Changelog

## [0.1.0] - 2026-06-09

### Added
- Initial release
- Pull scripts from TRMM API to local folder (scripts/ and snippets/)
- Push local changes to TRMM API (auto-create scripts missing IDs)
- Full sync (pull + push)
- Test scripts on remote agents
- Create new scripts with metadata stubs
- Edit metadata via quick-pick UI
- Auto-push on file save (configurable)
- Multi-instance ID tracking (hash-based to hide API URLs)
- Conflict resolution with interactive prompt (ask/local/api)
- CLI mode for cron/CI usage (trmm-sync)
- Context menu integration for test, push, and edit metadata
- Status bar with sync shortcut
- Esbuild bundling for fast startup
