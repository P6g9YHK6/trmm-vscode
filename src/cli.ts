#!/usr/bin/env node
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { ConsoleLogger, toErrorMessage } from './logger';
import { pullFromApi, pushToApi, ConfirmMutation } from './sync/syncEngine';
import { extractOrgFromUrl, getRelativeDir, generateName } from './commands/importFromGit';
import { buildScriptPath, inferShell, isScriptFile } from './utils/pathBuilder';
import { parseMetadata, buildFileContent, ScriptMetadata } from './sync/metadata';
import { sha256 } from './sync/hash';
import { readReportFiles, templateExtension } from './sync/reportSync';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PKG_VERSION: string = require('../package.json').version;

export interface CliOptions {
  command: string;
  apiUrl: string;
  apiKey: string;
  syncFolder: string;
  conflict: 'local' | 'api' | 'ask';
  paranoid: number;
  verbose: boolean;
  enableScripts: boolean;
  enableReports: boolean;
  enablePull: boolean;
  enablePush: boolean;
  enableGitHistory: boolean;
  staleStrategy: 'skip' | 'overwrite';
  stripMetadata: boolean;
  gitUrl: string;
  gitPath: string;
  paranoidAuto: '' | 'y' | 'n';
}

const VERSION = PKG_VERSION;

export function parseArgs(): CliOptions {
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
  if (!['pull', 'push', 'sync', 'import'].includes(command)) {
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
    paranoid: parsed['paranoid'] ? parseInt(parsed['paranoid'], 10) : (process.env.TRMM_PARANOID ? parseInt(process.env.TRMM_PARANOID, 10) : 0),
    verbose: parsed['verbose'] === 'true' || process.env.TRMM_VERBOSE === 'true' || false,
    enableScripts: parsed['enable-scripts'] !== 'false',
    enableReports: parsed['enable-reports'] !== 'false',
    enablePull: parsed['enable-pull'] !== 'false',
    enablePush: parsed['enable-push'] !== 'false',
    enableGitHistory: parsed['enable-git-history'] === 'true' || process.env.TRMM_GIT_HISTORY === 'true',
    staleStrategy: (parsed['stale-strategy'] || 'skip') as 'skip' | 'overwrite',
    stripMetadata: parsed['strip-metadata'] !== 'false',
    gitUrl: parsed['git-url'] || parsed['g'] || '',
    gitPath: parsed['git-path'] || '',
    paranoidAuto: (parsed['paranoid-auto'] || '') as '' | 'y' | 'n',
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
   import        Import scripts from a git repository

 Options:
   -u, --api-url <url>           TRMM API URL (env: TRMM_API_URL)
   -k, --api-key <key>           TRMM API key (env: TRMM_API_KEY)
   -d, --sync-folder <path>      Local sync folder (env: TRMM_SYNC_FOLDER)
   -c, --conflict <strategy>     Conflict: local | api (default: api)
    -p, --paranoid <n>            Paranoid mode: 0=off, 1=confirm all, 2=skip first (env: TRMM_PARANOID)
    --paranoid-auto <y|n>         Auto-answer paranoid prompts without stdin (for scripting)
    -v, --verbose                 Verbose output (env: TRMM_VERBOSE)
   --enable-scripts [bool]       Enable script/snippet sync (default: true)
   --enable-reports [bool]       Enable report template sync (default: true)
   --enable-pull [bool]          Allow pulling (default: true)
   --enable-push [bool]          Allow pushing (default: true)
   --enable-git-history [bool]   Git history sync (default: true, env: TRMM_GIT_HISTORY)
   --stale-strategy <strategy>   skip | overwrite (default: skip)
   --strip-metadata [bool]       Strip metadata from body on push (default: true)
   --git-url <url>               Git repo URL for import command (env: TRMM_GIT_URL)
   -g, --git-path <path>         Subfolder within repo to import
   --version                     Print version
   --help                        Print this help

 Environment variables:
   TRMM_API_URL, TRMM_API_KEY, TRMM_SYNC_FOLDER, TRMM_GIT_HISTORY,
   TRMM_PARANOID, TRMM_VERBOSE, TRMM_GIT_URL

 Examples:
   trmm-sync pull -u https://rmm-api.exemple.com -k token123 -d /opt/scripts
   trmm-sync push -u https://rmm-api.exemple.com -k token123 -d /opt/scripts --conflict local
   trmm-sync sync -u https://rmm-api.exemple.com -k token123 -d /opt/scripts
   trmm-sync import -g https://github.com/acme/toolkit.git --git-path scripts/
   trmm-sync push --enable-reports=false --enable-git-history=true
  `);
}

async function main() {
  const opts = parseArgs();

  if (!['import'].includes(opts.command)) {
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
  }

  const enableScripts = opts.enableScripts;
  const enableReports = opts.enableReports;
  const enablePull = opts.enablePull;
  const enablePush = opts.enablePush;
  const enableGitHistory = opts.enableGitHistory || process.env.TRMM_GIT_HISTORY === 'true';
  const staleStrategy = opts.staleStrategy;

  const logger = new ConsoleLogger();

  if (opts.command === 'import') {
    await runImport(opts, logger);
    return;
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

  const strategy = opts.conflict === 'ask' ? 'api' : opts.conflict;

  if (strategy !== opts.conflict) {
    console.log('Note: "ask" conflict strategy is not available in CLI mode, using "api"');
  }

  logger.appendLine(`Tactical RMM Script Sync v${VERSION}`);
  logger.appendLine(`API: ${apiUrl}`);
  logger.appendLine(`Folder: ${syncFolder}`);
  logger.appendLine(`Command: ${opts.command}`);
  logger.appendLine(`Scripts: ${enableScripts}, Reports: ${enableReports}, Pull: ${enablePull}, Push: ${enablePush}`);

  const confirmMutation: ConfirmMutation | undefined = opts.paranoid > 0
    ? (() => {
        let count = 0;
        return async (type, desc) => {
          count++;
          if (count < opts.paranoid) return true;
          if (opts.paranoidAuto === 'y') return true;
          if (opts.paranoidAuto === 'n') return false;
          return new Promise(resolve => {
            const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
            rl.question(`🔒 Paranoid: ${type} ${desc}? (y/N) `, (answer: string) => {
              rl.close();
              resolve(answer.toLowerCase() === 'y');
            });
          });
        };
      })()
    : undefined;

  try {
    if (opts.command === 'pull') {
      if (!enablePull) { logger.appendLine('Pull disabled'); process.exit(0); }
      const result = await pullFromApi(apiUrl, opts.apiKey, syncFolder, logger, strategy, undefined, enableScripts, enableReports, enableGitHistory);
      process.exit(result.errors.length > 0 ? 3 : 0);
    } else if (opts.command === 'push') {
      if (!enablePush) { logger.appendLine('Push disabled'); process.exit(0); }
      const result = await pushToApi(apiUrl, opts.apiKey, syncFolder, logger, strategy, undefined, confirmMutation, staleStrategy, enableScripts, enableReports, enableGitHistory);
      process.exit(result.errors.length > 0 ? 3 : 0);
    } else if (opts.command === 'sync') {
      if (enablePull && enablePush) {
        logger.appendLine('\n--- Phase 1: Pull ---');
        const pullResult = await pullFromApi(apiUrl, opts.apiKey, syncFolder, logger, strategy, undefined, enableScripts, enableReports, enableGitHistory);
        logger.appendLine('\n--- Phase 2: Push ---');
        const pushResult = await pushToApi(apiUrl, opts.apiKey, syncFolder, logger, strategy, undefined, confirmMutation, staleStrategy, enableScripts, enableReports, enableGitHistory);
        process.exit(pullResult.errors.length + pushResult.errors.length > 0 ? 3 : 0);
      } else if (enablePull) {
        const result = await pullFromApi(apiUrl, opts.apiKey, syncFolder, logger, strategy, undefined, enableScripts, enableReports, enableGitHistory);
        process.exit(result.errors.length > 0 ? 3 : 0);
      } else if (enablePush) {
        const result = await pushToApi(apiUrl, opts.apiKey, syncFolder, logger, strategy, undefined, confirmMutation, staleStrategy, enableScripts, enableReports, enableGitHistory);
        process.exit(result.errors.length > 0 ? 3 : 0);
      } else {
        logger.appendLine('Both pull and push are disabled');
        process.exit(0);
      }
    }
  } catch (e: unknown) {
    console.error(`Fatal error: ${toErrorMessage(e)}`);
    process.exit(2);
  }
}

async function runImport(opts: CliOptions, logger: ConsoleLogger) {
  const syncFolder = path.resolve(opts.syncFolder || process.env.TRMM_SYNC_FOLDER || '');
  if (!syncFolder) {
    console.error('Error: --sync-folder or TRMM_SYNC_FOLDER is required for import');
    process.exit(1);
  }
  if (!opts.gitUrl) {
    console.error('Error: --git-url or TRMM_GIT_URL is required for import');
    process.exit(1);
  }
  if (!fs.existsSync(syncFolder)) {
    fs.mkdirSync(syncFolder, { recursive: true });
  }

  const repoUrl = opts.gitUrl;
  const subfolder = opts.gitPath;
  const org = extractOrgFromUrl(repoUrl);

  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'trmm-import-'));
  logger.appendLine(`\n📥 Importing from ${repoUrl}`);

  try {
    logger.appendLine('   Cloning...');
    execSync(`git clone --depth 1 "${repoUrl}" "${tmpDir}"`, { stdio: 'pipe', timeout: 60000 });

    const targetDir = subfolder ? path.join(tmpDir, subfolder) : tmpDir;
    if (!fs.existsSync(targetDir)) {
      console.error(`Error: Subfolder "${subfolder}" not found in repo`);
      process.exit(1);
    }

    const imported: string[] = [];
    const renamed: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.')) walk(full);
        } else if (entry.isFile() && isScriptFile(full)) {
          const relDir = getRelativeDir(full, targetDir);
          const content = fs.readFileSync(full, 'utf-8');
          const shell = inferShell(full);
          const parsed = parseMetadata(content, shell);
          const name = generateName(parsed, full);
          const catParts: string[] = [org];
          if (parsed && parsed.metadata.category?.trim()) {
            catParts.push(parsed.metadata.category);
          } else if (relDir) {
            catParts.push(relDir);
          } else {
            catParts.push('uncategorised');
          }
          const category = catParts.join('/');
          let destPath = buildScriptPath(syncFolder, name, category, shell);
          let finalName = name;
          if (fs.existsSync(destPath)) {
            finalName = `${name}-${org}`;
            destPath = buildScriptPath(syncFolder, finalName, category, shell);
            renamed.push(`${name} → ${finalName}`);
            if (fs.existsSync(destPath)) { skipped.push(finalName); continue; }
          }
          const newMeta: ScriptMetadata = {
            name: finalName, description: parsed?.metadata.description || '', shell, category,
            supported_platforms: parsed?.metadata.supported_platforms || [],
            args: parsed?.metadata.args || [], env_vars: parsed?.metadata.env_vars || [],
            default_timeout: parsed?.metadata.default_timeout ?? 90, run_as_user: false,
            syntax: '', favorite: false, hidden: false, code_hash: sha256(content), ids: {},
          };
          try {
            const fileContent = buildFileContent(parsed ? parsed.code : content, newMeta);
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.writeFileSync(destPath, fileContent, 'utf-8');
            imported.push(finalName);
          } catch (e: unknown) {
            errors.push(`${finalName}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
    }

    walk(targetDir);

    const reportsSrcDir = path.join(targetDir, 'reports');
    if (fs.existsSync(reportsSrcDir)) {
      for (const entry of fs.readdirSync(reportsSrcDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const parsed = readReportFiles(path.join(reportsSrcDir, entry.name));
        if (!parsed) { skipped.push(`reports/${entry.name} (invalid meta.json)`); continue; }
        let destFolder = path.join(syncFolder, 'reports', entry.name);
        if (fs.existsSync(destFolder)) {
          const newName = `${entry.name}-${org}`;
          destFolder = path.join(syncFolder, 'reports', newName);
          renamed.push(`reports/${entry.name} → reports/${newName}`);
          if (fs.existsSync(destFolder)) { skipped.push(`reports/${newName}`); continue; }
        }
        try {
          fs.mkdirSync(destFolder, { recursive: true });
          if (parsed.content.template_md) {
            const ext = templateExtension(parsed.meta.type);
            fs.writeFileSync(path.join(destFolder, `template${ext}`), parsed.content.template_md, 'utf-8');
          }
          if (parsed.content.template_css) fs.writeFileSync(path.join(destFolder, 'style.css'), parsed.content.template_css, 'utf-8');
          if (parsed.content.template_variables) fs.writeFileSync(path.join(destFolder, 'variables.yaml'), parsed.content.template_variables, 'utf-8');
          fs.writeFileSync(path.join(destFolder, 'meta.json'), JSON.stringify(parsed.meta, null, 2), 'utf-8');
          imported.push(`reports/${path.basename(destFolder)}`);
        } catch (e: unknown) { errors.push(`reports/${entry.name}: ${e instanceof Error ? e.message : String(e)}`); }
      }
    }

    console.log(`\n📊 Import complete:`);
    console.log(`   Imported: ${imported.length}`);
    if (renamed.length) console.log(`   Renamed: ${renamed.length}`);
    if (skipped.length) console.log(`   Skipped: ${skipped.length}`);
    if (errors.length) console.log(`   Errors: ${errors.length}`);
    process.exit(errors.length > 0 ? 3 : 0);
  } catch (e: unknown) {
    console.error(`Import failed: ${toErrorMessage(e)}`);
    process.exit(2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (!process.env.VITEST) {
  main();
}
