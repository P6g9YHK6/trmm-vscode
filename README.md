# TRMM Script Manager

Sync [Tactical RMM](https://tacticalrmm.com/) scripts between your API and VS Code.

## Features

- **Pull** — download scripts/snippets from API to `scripts/<category>/<name>.<ext>`
- **Push** — upload local changes; new files create on API
- **Test** — run scripts on agents, see stdout/stderr in panel
- **Side Panel** — edit metadata fields, test scripts from activity bar
- **CLI** — `trmm-sync` for cron/CI (supports env vars)
- **Multi-Instance** — track script IDs across TRMM instances with hash-based IDs

## Commands

| Command | Title | Description |
|---------|-------|-------------|
| `trmm.pull` | TRMM: Pull All Scripts from API | Download scripts and snippets from the API |
| `trmm.push` | TRMM: Push All Changes to API | Upload changed local scripts to the API |
| `trmm.pushFile` | TRMM: Push Current File to API | Upload the currently open script |
| `trmm.sync` | TRMM: Full Sync (Pull + Push) | Pull then push |
| `trmm.testOnAgent` | TRMM: Test Script on Agent | Run the open script on a selected agent |
| `trmm.newScript` | TRMM: Create New Script | Create a new script file with metadata |
| `trmm.editMetadata` | TRMM: Edit Script Metadata | Edit metadata fields interactively |
| `trmm.openSyncFolder` | TRMM: Open Sync Folder | Add the sync folder to workspace |
| `trmm.refreshAgents` | TRMM: Refresh Agent Cache | Reload the agent list |

## Requirements

- VS Code 1.85+
- TRMM instance with API key (read/write)

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `trmm.apiUrl` | — | API base URL |
| `trmm.apiKey` | — | API key |
| `trmm.syncFolder` | — | Local sync folder |
| `trmm.autoPush` | `false` | Auto-push on save |
| `trmm.conflictStrategy` | `ask` | Conflict: `ask`, `local`, `api` |
| `trmm.defaultShell` | `powershell` | Default shell for new scripts |

## Metadata Format

Metadata is stored inline at the bottom of each script file:

```
# --- TRMM METADATA BEGIN ---
# name: Check Disk Space
# shell: powershell
# category: Checks
# default_timeout: 90
# ids: a1b2c3d4=42
# --- TRMM METADATA END ---
```

Supported prefixes: `# ` (PowerShell/Python/Shell/Nushell), `REM ` (Batch), `// ` (Deno/JS/TS)

## CLI

```bash
# env vars or flags
trmm-sync pull -u https://rmm-api.exemple.com -k API_KEY -d /path/to/sync
trmm-sync push -u https://rmm-api.exemple.com -k API_KEY -d /path/to/sync
```

Env vars: `TRMM_API_URL`, `TRMM_API_KEY`, `TRMM_SYNC_FOLDER`

## License

MPL-2.0
