# TRMM Script Manager

[![CI](https://github.com/P6g9YHK6/trmm-vscode/actions/workflows/ci.yml/badge.svg)](https://github.com/P6g9YHK6/trmm-vscode/actions)
[![License](https://img.shields.io/badge/license-MPL--2.0-blue)](LICENSE)

Sync [Tactical RMM](https://tacticalrmm.com/) scripts, snippets, and report templates between your API and VS Code.

On first install, a setup wizard walks you through configuring the API URL, key, sync folder, and preferences. You can re-run it anytime from the command palette (`TRMM: Setup Wizard`).

## Download

[![VS Code Marketplace](https://badgen.net/vs-marketplace/v/P6g9YHK6.trmm-vscode)](https://marketplace.visualstudio.com/items?itemName=P6g9YHK6.trmm-vscode)
[![Open VSX](https://img.shields.io/open-vsx/v/P6g9YHK6/trmm-vscode?label=Open%20VSX)](https://open-vsx.org/extension/P6g9YHK6/trmm-vscode)
[![GitHub Release](https://img.shields.io/github/v/release/P6g9YHK6/trmm-vscode?label=GitHub)](https://github.com/P6g9YHK6/trmm-vscode/releases)

Quick links: [Changelog](./CHANGELOG.md) · [Issues](https://github.com/P6g9YHK6/trmm-vscode/issues) · [License](LICENSE)

## Features

- **Pull** — download scripts, snippets, and reports from API to local folder
- **Push** — upload local changes; new files create on API
- **Test** — run scripts on agents, see stdout/stderr in panel
- **Side Panel** — edit metadata fields, test scripts from activity bar
- **CLI** — `trmm-sync` for cron/CI/CD and headless use (supports env vars)
- **Setup Wizard** — guided first-run configuration, re-runnable from command palette
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

| Command | What it does |
|---------|-------------|
| `TRMM: Pull All Scripts from API` | Download scripts and snippets from the API |
| `TRMM: Push All Changes to API` | Upload changed local scripts to the API |
| `TRMM: Push Current File to API` | Upload the currently open script |
| `TRMM: Full Sync (Pull + Push)` | Pull then push |
| `TRMM: Test Script on Agent` | Run the open script on a selected agent |
| `TRMM: Create New Script` | Create a new script file with metadata |
| `TRMM: Edit Script Metadata` | Edit metadata fields interactively |
| `TRMM: Open Sync Folder` | Add the sync folder to workspace |
| `TRMM: Import Scripts from Git Repo` | Clone a git repo and import scripts into the sync folder |
| `TRMM: Debug Auth` | Show API URL/key status and test the connection |
| `TRMM: Setup Wizard` | Guided setup for API URL, key, sync folder, and preferences |
| `TRMM: Open Script Editor` | Open the side panel for editing script metadata |

## SCM Integration

The extension registers a custom source control provider that shows added, modified, and deleted scripts/snippets. The standard git publish branch dropdown also includes a **Push to TRMM** option when a repo has no remotes configured.

## Settings

| Setting | Default | What it does |
|---------|---------|-------------|
| `trmm.apiUrl` | — | API base URL |
| `trmm.apiKey` | — | API key (stored in OS keychain, not settings) |
| `trmm.syncFolder` | — | Local folder for synced scripts |
| `trmm.autoPush` | `false` | Push to API automatically on save |
| `trmm.paranoidMode` | `false` | Ask confirmation before every API mutation |
| `trmm.conflictStrategy` | `ask` | How to resolve local/API conflicts |
| `trmm.defaultShell` | `powershell` | Default shell for new scripts |
| `trmm.enableScripts` | `true` | Enable script/snippet sync |
| `trmm.enableReports` | `true` | Enable report template sync |
| `trmm.enableGitHistory` | `true` | Sync git history across machines via API |
| `trmm.staleStrategy` | `skip` | What to do when API changed since last pull |
| `trmm.stripMetadata` | `true` | Strip metadata block from body on push |
| `trmm.verboseLogging` | `false` | Detailed debug logging |

## Security

- **API Key** is stored in VS Code's `SecretStorage` (OS keychain on supported platforms). Never written to settings files or logs.
- **`trmm.stripMetadata`** (default `true`): metadata blocks are stripped before scripts are sent to agents during testing.
- **Paranoid mode** (`trmm.paranoidMode`): every create/update/delete requires explicit confirmation via a VS Code dialog.
- **Manifest integrity**: the `.trmm-manifest.json` file is validated before push. Corruption triggers a dialog offering rebuild from local files or re-pull from API.

## Metadata Format

Metadata lives at the bottom of each script file in a block comment:

```
# --- TRMM METADATA BEGIN ---
# name: Check Disk Space
# shell: powershell
# category: Checks
# default_timeout: 90
# ids: a1b2c3d4=42
# --- TRMM METADATA END ---
```

Supports `# ` (PowerShell/Python/Shell/Nushell), `REM ` (Batch), `// ` (Deno/JS/TS).

## CLI

The `trmm-sync` CLI handles the same sync operations for cron, CI/CD, or headless use.

### Commands

| Command | What it does |
|---------|-------------|
| `trmm-sync pull` | Download scripts from API |
| `trmm-sync push` | Upload local changes to API |
| `trmm-sync sync` | Pull then push |
| `trmm-sync import` | Import scripts from a git repo |

### Options

| Flag | Env var | What it does |
|------|---------|-------------|
| `-u, --api-url` | `TRMM_API_URL` | API base URL |
| `-k, --api-key` | `TRMM_API_KEY` | API key |
| `-d, --sync-folder` | `TRMM_SYNC_FOLDER` | Local sync folder |
| `-c, --conflict` | — | Conflict strategy: `local` or `api` (default: `api`) |
| `-p, --paranoid` | `TRMM_PARANOID` | Confirm before mutations |
| `-v, --verbose` | `TRMM_VERBOSE` | Verbose output |
| `--enable-scripts` | — | Script sync on/off (default: true) |
| `--enable-reports` | — | Report sync on/off (default: true) |
| `--enable-git-history` | `TRMM_GIT_HISTORY` | Git history sync on/off (default: true) |
| `--stale-strategy` | — | `skip` or `overwrite` (default: `skip`) |
| `--strip-metadata` | — | Strip metadata on push (default: true) |
| `--git-url, -g` | `TRMM_GIT_URL` | Git repo URL for import |
| `--git-path` | — | Subfolder within repo for import |

### Examples

```bash
trmm-sync pull -u https://rmm-api.example.com -k token123 -d /opt/scripts
trmm-sync push -u https://rmm-api.example.com -k token123 -d /opt/scripts --conflict local
trmm-sync sync -u https://rmm-api.example.com -k token123 -d /opt/scripts
trmm-sync import -g https://github.com/acme/toolkit.git --git-path scripts/ -d /opt/scripts
```

## License

MPL-2.0
