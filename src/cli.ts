#!/usr/bin/env node
import * as path from 'path';
import * as fs from 'fs';
import { ConsoleLogger } from './logger';
import { pullFromApi, pushToApi } from './sync/syncEngine';

const VERSION = '0.1.0';

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp();
    process.exit(0);
  }
  if (args[0] === '--version') {
    console.log(`trmm-sync v${VERSION}`);
    process.exit(0);
  }

  const command = args[0];
  if (!['pull', 'push', 'sync'].includes(command)) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }

  const parsed: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eqIdx = arg.indexOf('=');
      const key = eqIdx !== -1 ? arg.slice(2, eqIdx) : arg.slice(2);
      const val = eqIdx !== -1 ? arg.slice(eqIdx + 1) : args[++i];
      if (val) parsed[key] = val;
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg[1];
      const val = args[++i];
      if (val) parsed[key] = val;
    }
  }

  return {
    command,
    apiUrl: parsed['api-url'] || parsed['u'] || process.env.TRMM_API_URL || '',
    apiKey: parsed['api-key'] || parsed['k'] || process.env.TRMM_API_KEY || '',
    syncFolder: parsed['sync-folder'] || parsed['d'] || process.env.TRMM_SYNC_FOLDER || '',
    conflict: (parsed['conflict'] || parsed['c'] || 'api') as 'local' | 'api' | 'ask',
    verbose: parsed['verbose'] === 'true' || parsed['v'] === 'true' || false,
  };
}

function printHelp() {
  console.log(`
trmm-sync v${VERSION} — Tactical RMM Script Sync (CLI)

Usage:
  trmm-sync <command> [options]

Commands:
  pull          Pull scripts from TRMM API to local folder
  push          Push local script changes to TRMM API
  sync          Pull then push (full sync)

Options:
  -u, --api-url <url>        TRMM API URL (or env: TRMM_API_URL)
  -k, --api-key <key>        TRMM API key (or env: TRMM_API_KEY)
  -d, --sync-folder <path>   Local sync folder (or env: TRMM_SYNC_FOLDER)
  -c, --conflict <strategy>  Conflict resolution: local | api (default: api)
  -v, --verbose              Verbose output
  --version                  Print version
  --help                     Print this help

Environment variables:
  TRMM_API_URL, TRMM_API_KEY, TRMM_SYNC_FOLDER

Examples:
  trmm-sync pull -u https://rmm.example.com -k token123 -d /opt/scripts
  trmm-sync push -u https://rmm.example.com -k token123 -d /opt/scripts --conflict local
  trmm-sync sync -u https://rmm.example.com -k token123 -d /opt/scripts
`);
}

async function main() {
  const opts = parseArgs();

  if (!opts.apiUrl) {
    console.error('Error: --api-url (-u) or TRMM_API_URL env var is required');
    process.exit(1);
  }
  if (!opts.apiKey) {
    console.error('Error: --api-key (-k) or TRMM_API_KEY env var is required');
    process.exit(1);
  }
  if (!opts.syncFolder) {
    console.error('Error: --sync-folder (-d) or TRMM_SYNC_FOLDER env var is required');
    process.exit(1);
  }

  const syncFolder = path.resolve(opts.syncFolder);
  if (!fs.existsSync(syncFolder)) {
    fs.mkdirSync(syncFolder, { recursive: true });
    console.log(`Created sync folder: ${syncFolder}`);
  }

  const apiUrl = opts.apiUrl.replace(/\/+$/, '');
  if (!apiUrl.startsWith('http://') && !apiUrl.startsWith('https://')) {
    console.error('Error: api-url must start with http:// or https://');
    process.exit(1);
  }

  const logger = new ConsoleLogger();
  const strategy = opts.conflict === 'ask' ? 'api' : opts.conflict;

  if (strategy !== opts.conflict) {
    console.log('Note: "ask" conflict strategy is not available in CLI mode, using "api"');
  }

  logger.appendLine(`Tactical RMM Script Sync v${VERSION}`);
  logger.appendLine(`API: ${apiUrl}`);
  logger.appendLine(`Folder: ${syncFolder}`);
  logger.appendLine(`Command: ${opts.command}`);

  try {
    if (opts.command === 'pull') {
      const result = await pullFromApi(apiUrl, opts.apiKey, syncFolder, logger, strategy);
      process.exit(result.errors.length > 0 ? 3 : 0);
    } else if (opts.command === 'push') {
      const result = await pushToApi(apiUrl, opts.apiKey, syncFolder, logger, strategy);
      process.exit(result.errors.length > 0 ? 3 : 0);
    } else if (opts.command === 'sync') {
      logger.appendLine('\n--- Phase 1: Pull ---');
      const pullResult = await pullFromApi(apiUrl, opts.apiKey, syncFolder, logger, strategy);

      logger.appendLine('\n--- Phase 2: Push ---');
      const pushResult = await pushToApi(apiUrl, opts.apiKey, syncFolder, logger, strategy);

      const totalErrors = pullResult.errors.length + pushResult.errors.length;
      process.exit(totalErrors > 0 ? 3 : 0);
    }
  } catch (e: any) {
    console.error(`Fatal error: ${e.message}`);
    process.exit(2);
  }
}

main();
