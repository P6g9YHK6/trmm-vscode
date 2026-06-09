# Tactical RMM Script Manager

Manage [Tactical RMM](https://tacticalrmm.com/) scripts directly from VS Code. Pull scripts from your TRMM instance, edit locally with syntax highlighting, push changes back, test on agents, and track multi-instance IDs — all without leaving your editor.

## Features

- **Pull** — Download all scripts and snippets from your TRMM API into a local folder structure (`scripts/<category>/<name>.<ext>`)
- **Push** — Upload local changes to the API. New local files are auto-created on the API
- **Sync** — Pull then push in one command
- **Test on Agent** — Run any script on a remote agent and see stdout/stderr in real-time
- **New Script** — Scaffold a new script with metadata stub
- **Edit Metadata** — Quick-pick UI to edit any metadata field inline
- **Auto-Push** — Optional: auto-push to API on file save
- **CLI** — Standalone CLI (`trmm-sync`) for cron jobs and CI pipelines
- **Multi-Instance** — Track script IDs across multiple TRMM instances simultaneously via hash-based ID mapping

## Commands

| Command | Title | Description |
|---------|-------|-------------|
| `trmm.pull` | TRMM: Pull All Scripts from API | Download all scripts and snippets from the API |
| `trmm.push` | TRMM: Push All Changes to API | Upload changed local scripts to the API |
| `trmm.pushFile` | TRMM: Push Current File to API | Upload the currently open script |
| `trmm.sync` | TRMM: Full Sync (Pull + Push) | Pull then push in sequence |
| `trmm.testOnAgent` | TRMM: Test Script on Agent | Run the open script on a selected agent |
| `trmm.newScript` | TRMM: Create New Script | Create a new script file with metadata |
| `trmm.editMetadata` | TRMM: Edit Script Metadata | Edit metadata fields interactively |
| `trmm.openSyncFolder` | TRMM: Open Sync Folder | Add the sync folder to workspace |
| `trmm.refreshAgents` | TRMM: Refresh Agent Cache | Reload the agent list |

## Requirements

- VS Code 1.85+ or VS Codium
- Tactical RMM instance with API access
- API key with read/write permissions

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `trmm.apiUrl` | — | TRMM API base URL (e.g. `https://api-rmm.example.com`) |
| `trmm.apiKey` | — | API key sent as `X-API-KEY` header |
| `trmm.syncFolder` | — | Local folder where scripts/ and snippets/ will be synced |
| `trmm.autoPush` | `false` | Auto-push file to API on save |
| `trmm.conflictStrategy` | `ask` | Conflict resolution: `ask`, `local`, or `api` |
| `trmm.defaultShell` | `powershell` | Default shell for new scripts |

## Metadata Format

Each script file stores its TRMM metadata inline at the bottom as comment blocks:

```
# --- TRMM METADATA BEGIN ---
# name: Check Disk Space
# description: Checks disk space on all drives
# shell: powershell
# category: Checks
# supported_platforms: ["windows"]
# args: []
# env_vars: []
# default_timeout: 90
# run_as_user: false
# syntax: ""
# favorite: false
# hidden: false
# code_hash: abc123def456...
# ids: a1b2c3d4=42 e5f6g7h8=99
# --- TRMM METADATA END ---
```

Supported comment prefixes:
| Language | Prefix |
|----------|--------|
| PowerShell | `# ` |
| Python | `# ` |
| Batch | `REM ` |
| Shell | `# ` |
| Nushell | `# ` |
| Deno/JS/TS | `// ` |

## CLI Usage

```bash
trmm-sync pull -u https://rmm.example.com -k YOUR_API_KEY -d /path/to/sync
trmm-sync push -u https://rmm.example.com -k YOUR_API_KEY -d /path/to/sync
trmm-sync sync -u https://rmm.example.com -k YOUR_API_KEY -d /path/to/sync
```

Environment variables: `TRMM_API_URL`, `TRMM_API_KEY`, `TRMM_SYNC_FOLDER`

## Multi-Instance ID Tracking

The `ids` field stores a hash of each API URL mapped to the script's ID on that instance:

```
ids: a1b2c3d4=42 e5f6g7h8=99
```

This keeps instance URLs private while allowing one file to track its ID across multiple TRMM servers.

## License

[Mozilla Public License 2.0](LICENSE)
