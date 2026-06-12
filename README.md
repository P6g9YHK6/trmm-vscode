# TRMM Script Manager

[![CI](https://github.com/P6g9YHK6/trmm-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/P6g9YHK6/trmm-vscode/actions)
[![License](https://img.shields.io/badge/license-MPL--2.0-blue)](LICENSE)

Sync [Tactical RMM](https://tacticalrmm.com/) scripts between your API and VS Code.

## Download

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/P6g9YHK6.trmm-vscode?label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=P6g9YHK6.trmm-vscode)
[![Open VSX](https://img.shields.io/open-vsx/v/P6g9YHK6/trmm-vscode?label=Open%20VSX)](https://open-vsx.org/extension/P6g9YHK6/trmm-vscode)
[![GitHub Release](https://img.shields.io/github/v/release/P6g9YHK6/trmm-vscode?label=GitHub)](https://github.com/P6g9YHK6/trmm-vscode/releases)

[![Marketplace Downloads](https://img.shields.io/visual-studio-marketplace/d/P6g9YHK6.trmm-vscode)](https://marketplace.visualstudio.com/items?itemName=P6g9YHK6.trmm-vscode)
[![GitHub Downloads](https://img.shields.io/github/downloads/P6g9YHK6/trmm-vscode/total)](https://github.com/P6g9YHK6/trmm-vscode/releases)

Quick links: [Changelog](./CHANGELOG.md) · [Issues](https://github.com/P6g9YHK6/trmm-vscode/issues) · [License](LICENSE)

## Features

- **Pull** — download scripts/snippets/reports from API to local folder
- **Push** — upload local changes; new files create on API
- **Test** — run scripts on agents, see stdout/stderr in panel
- **Side Panel** — edit metadata fields, test scripts from activity bar
- **CLI** — `trmm-sync` for cron/CI (supports env vars)
- **Multi-Instance** — track script IDs across TRMM instances with hash-based IDs

## Supported Languages

**Scripting:**
![PowerShell](https://img.shields.io/badge/powershell-%5E5.1-blue)
![Python](https://img.shields.io/badge/python-3.x-green)
![Batch](https://img.shields.io/badge/batch-cmd-lightgrey)
![Shell](https://img.shields.io/badge/shell-bash%20%7C%20zsh-orange)
![Nushell](https://img.shields.io/badge/nushell-%5E0.90-purple)
![Deno](https://img.shields.io/badge/deno-%5E2.0-black)

**Reporting:**
![HTML](https://img.shields.io/badge/html-5-red)
![Markdown](https://img.shields.io/badge/markdown-v2-blue)
![Plain Text](https://img.shields.io/badge/plain%20text-txt-lightgrey)

## Commands

| Command | Title | Description |
|---------|-------|-------------|
| `trmm.pull` | TRMM: Pull All Scripts from API | Download scripts, snippets, and reports from the API |
| `trmm.push` | TRMM: Push All Changes to API | Upload changed local files to the API |
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
| `trmm.apiKey` | — | API key (stored in SecretStorage) |
| `trmm.syncFolder` | — | Local sync folder |
| `trmm.autoPush` | `false` | Auto-push on save |
| `trmm.conflictStrategy` | `ask` | Conflict: `ask`, `local`, `api` |
| `trmm.defaultShell` | `powershell` | Default shell for new scripts |
| `trmm.paranoidMode` | `false` | Require confirmation for create/update/delete |
| `trmm.stripMetadata` | `true` | Strip metadata before sending to agents |
| `trmm.verboseLogging` | `false` | Detailed logging in output channel |

## Security

- **API Key** is stored in VS Code's `SecretStorage` (OS keychain on supported platforms). Never written to settings files or logs.
- **`trmm.stripMetadata`** (default `true`): metadata blocks are stripped before scripts are sent to agents during testing.
- **Paranoid mode** (`trmm.paranoidMode`): every create/update/delete requires explicit confirmation via a VS Code dialog.
- **Manifest integrity**: the `.trmm-manifest.json` file is validated before push. Corruption triggers a dialog offering rebuild from local files or re-pull from API.

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
