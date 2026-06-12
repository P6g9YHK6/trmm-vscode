import * as fs from 'fs';
import * as path from 'path';
import { TrmmApi, ScriptHeader, ScriptDownload, SnippetHeader } from '../api/trmmApi';
import { parseMetadata, parseBlockCommentMetadata, buildFileContent, buildSnippetFileContent, ScriptMetadata, computeMetaHash } from './metadata';
import { sha256, hashUrl } from './hash';
import { buildScriptPath, sanitizeName, inferShell, isScriptFile } from '../utils/pathBuilder';
import { getConfig } from '../utils/config';
import { Logger, toErrorMessage } from '../logger';
import { AxiosError } from 'axios';
import { commitSyncChanges } from './gitSync';
import {
  pullReportsFromApi,
  pushReportsToApi,
  deleteReportFromApi,
  scanReportManifest,
  ReportManifestEntry,
} from './reportSync';
import { pullGitHistory, pushGitHistory } from './gitHistorySync';

export interface SyncManifestEntry {
  id: number;
  type: 'script' | 'snippet' | 'report';
  shell?: string;
  folder?: string;
}

export interface SyncManifest {
  version: number;
  files: Record<string, SyncManifestEntry>;
}

function manifestPath(syncFolder: string): string {
  return path.join(syncFolder, '.trmm-manifest.json');
}

export function loadManifest(syncFolder: string): SyncManifest {
  try {
    const raw = fs.readFileSync(manifestPath(syncFolder), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { version: 1, files: {} };
  }
}

function saveManifest(syncFolder: string, manifest: SyncManifest): void {
  writeFile(manifestPath(syncFolder), JSON.stringify(manifest, null, 2));
}

function rebuildManifestFromDisk(syncFolder: string, apiUrl: string): SyncManifest {
  const manifest: SyncManifest = { version: 1, files: {} };
  for (const subdir of ['scripts', 'snippets']) {
    const dir = path.join(syncFolder, subdir);
    if (!fs.existsSync(dir)) continue;
    const files = findFiles(dir);
    for (const filePath of files) {
      const relPath = path.relative(syncFolder, filePath);
      const content = readFile(filePath);
      if (!content) continue;
      const shell = inferShell(filePath);
      const parsed = tryParseMetadata(content, shell);
      if (parsed) {
        const id = parsed.metadata.ids[hashUrl(apiUrl)];
        if (id !== undefined) {
          const type = subdir === 'snippets' ? 'snippet' : 'script';
          manifest.files[relPath] = { id, type, shell };
        }
      }
    }
  }
  return manifest;
}

export interface SyncResult {
  pulled: number;
  pushed: number;
  created: number;
  deleted: number;
  skipped: number;
  errors: string[];
}

export type ConflictResolver = (filePath: string, direction: 'pull' | 'push', localContent?: string, apiContent?: string) => Promise<'local' | 'api' | 'local-all' | 'api-all'>;

export type ConfirmMutation = (type: 'create' | 'update' | 'delete', description: string) => Promise<boolean>;

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function readFile(p: string): string | null {
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return null;
  }
}

function writeFile(p: string, content: string): void {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, content, 'utf-8');
}

function deleteFile(p: string): void {
  try {
    fs.unlinkSync(p);
  } catch { /* ok */ }
}

function removeEmptyDirs(dir: string): void {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      removeEmptyDirs(path.join(dir, entry.name));
    }
  }
  if (fs.readdirSync(dir).length === 0) {
    try { fs.rmdirSync(dir); } catch { /* ok */ }
  }
}

function tryParseMetadata(content: string, shell: string): { code: string; metadata: ScriptMetadata } | null {
  if (shell === 'powershell' || shell === 'python' || shell === 'deno') {
    const blockParsed = parseBlockCommentMetadata(content);
    if (blockParsed) return blockParsed;
  }
  return parseMetadata(content, shell);
}

function metadataFromHeader(header: ScriptHeader, codeHash: string, ids: Record<string, number>): ScriptMetadata {
  return {
    name: header.name,
    description: header.description || '',
    shell: header.shell,
    category: header.category || '',
    supported_platforms: header.supported_platforms || [],
    args: header.args || [],
    env_vars: header.env_vars || [],
    default_timeout: header.default_timeout || 90,
    run_as_user: header.run_as_user || false,
    syntax: header.syntax || '',
    favorite: header.favorite || false,
    hidden: header.hidden || false,
    code_hash: codeHash,
    meta_hash: '',
    ids,
  };
}

export async function pullFromApi(
  apiUrl: string,
  apiKey: string,
  syncFolder: string,
  outputChannel: Logger,
  strategy: 'ask' | 'local' | 'api',
  onConflict?: ConflictResolver,
  enableScripts?: boolean,
  enableReports?: boolean,
  enableGitHistory?: boolean,
): Promise<SyncResult> {
  const result: SyncResult = { pulled: 0, pushed: 0, created: 0, deleted: 0, skipped: 0, errors: [] };
  const api = new TrmmApi(apiUrl, apiKey);
  const scriptsDir = path.join(syncFolder, 'scripts');
  const snippetsDir = path.join(syncFolder, 'snippets');

  ensureDir(scriptsDir);
  ensureDir(snippetsDir);

  const keptFiles = new Set<string>();

  if (enableScripts !== false) {
  outputChannel.appendLine('\n===== Pull: Fetching Scripts =====');
  outputChannel.verbose(`GET ${api.apiUrl}/scripts/?showHiddenScripts=true`);

  let apiScripts: ScriptHeader[] = [];
  try {
    apiScripts = await api.fetchScripts();
    apiScripts = apiScripts.filter(s => s.name !== '__git_history__');
    outputChannel.verbose(`Found ${apiScripts.length} scripts on API`);
  } catch (e: unknown) {
    const msg = toErrorMessage(e);
    result.errors.push(`Failed to fetch scripts: ${msg}`);
    outputChannel.appendLine(`❌ ${msg}`);
    if (e instanceof AxiosError && e.response) {
      outputChannel.verbose(`HTTP ${e.response.status}: ${JSON.stringify(e.response.data).slice(0, 500)}`);
    }
    outputChannel.verbose('Check that your API URL and key are correct.');
  }

  for (const s of apiScripts) {
    try {
      const filePath = buildScriptPath(syncFolder, s.name, s.category, s.shell);
      keptFiles.add(filePath);

      let download: ScriptDownload;
      try {
        download = await api.downloadScript(s.id);
      } catch (e: unknown) {
        const msg = toErrorMessage(e);
        result.errors.push(`Failed to download script #${s.id} (${s.name}): ${msg}`);
        outputChannel.appendLine(`  ⚠️ Skipping #${s.id} ${s.name}: download failed`);
        continue;
      }

      const newCode = download.code.trimEnd();
      const existing = readFile(filePath);
      const newHash = sha256(newCode);
      const existingParsed = existing ? tryParseMetadata(existing, s.shell) : null;
      const existingIds = existingParsed?.metadata.ids || {};
      const apiMeta = metadataFromHeader(s, newHash, { ...existingIds, [hashUrl(apiUrl)]: s.id });
      apiMeta.meta_hash = computeMetaHash(apiMeta);
      const apiContent = buildFileContent(newCode, apiMeta);

      if (existing !== null) {
        if (apiContent === existing) {
          result.skipped++;
        } else if (existingParsed) {
          const existingHash = sha256(existingParsed.code);

          if (existingHash === existingParsed.metadata.code_hash && existingHash !== newHash) {
            writeFile(filePath, apiContent);
            result.pulled++;
            outputChannel.appendLine(`  📥 Updated: ${s.category}/${s.name}`);
          } else if (buildFileContent(existingParsed.code, existingParsed.metadata) === apiContent) {
            writeFile(filePath, apiContent);
            outputChannel.appendLine(`  📋 Normalized metadata format: ${s.category}/${s.name}`);
          } else {
            const action = await resolveConflict(filePath, 'pull', strategy, onConflict, existing, apiContent);
            if (action === 'api-all' || action === 'local-all') {
              strategy = action === 'api-all' ? 'api' : 'local';
            }
            if (action === 'api' || action === 'api-all') {
              writeFile(filePath, apiContent);
              result.pulled++;
              outputChannel.appendLine(`  📥 Overwrote local (API won): ${s.category}/${s.name}`);
            } else {
              result.skipped++;
              outputChannel.appendLine(`  ⏭️ Kept local: ${s.category}/${s.name}`);
            }
          }
        } else {
          writeFile(filePath, apiContent);
          result.pulled++;
          outputChannel.appendLine(`  📥 Added metadata to existing file: ${s.category}/${s.name}`);
        }
      } else {
        writeFile(filePath, apiContent);
        result.pulled++;
        result.created++;
        outputChannel.appendLine(`  📄 Created: ${s.category}/${s.name}`);
      }
    } catch (e: unknown) {
      const msg = toErrorMessage(e);
      result.errors.push(`Error processing script ${s.name}: ${msg}`);
      outputChannel.appendLine(`  ❌ Error: ${msg}`);
    }
  }
  }

  if (enableScripts !== false) {
    outputChannel.appendLine('\n----- Pull: Snippets -----');

    let apiSnippets: SnippetHeader[] = [];
    try {
      apiSnippets = await api.fetchSnippets();
      outputChannel.verbose(`Found ${apiSnippets.length} snippets on API`);
    } catch (e: unknown) {
      result.errors.push(`Failed to fetch snippets: ${toErrorMessage(e)}`);
    }

    for (const sn of apiSnippets) {
      try {
        const filePath = path.join(snippetsDir, `${sanitizeName(sn.name)}.ps1`);
        keptFiles.add(filePath);

        const newCode = sn.code.trimEnd();
        const existing = readFile(filePath);

        if (existing !== null) {
          const parsed = tryParseMetadata(existing, 'powershell');
          if (parsed) {
            const existingHash = sha256(parsed.code);
            const newHash = sha256(newCode);

            if (existingHash === parsed.metadata.code_hash && existingHash !== newHash) {
              writeFile(filePath, buildSnippetFileContent(newCode, {
                ...parsed.metadata,
                code_hash: newHash,
                ids: { ...parsed.metadata.ids, [hashUrl(apiUrl)]: sn.id },
              }));
              result.pulled++;
              outputChannel.appendLine(`  📥 Updated snippet: ${sn.name}`);
            } else if (existingHash !== parsed.metadata.code_hash && existingHash !== newHash) {
              const action = await resolveConflict(filePath, 'pull', strategy, onConflict, existing, newCode);
              if (action === 'api-all' || action === 'local-all') {
                strategy = action === 'api-all' ? 'api' : 'local';
              }
              if (action === 'api' || action === 'api-all') {
                writeFile(filePath, buildSnippetFileContent(newCode, {
                  ...parsed.metadata,
                  code_hash: newHash,
                  ids: { ...parsed.metadata.ids, [hashUrl(apiUrl)]: sn.id },
                }));
                result.pulled++;
              } else {
                result.skipped++;
              }
            } else {
              result.skipped++;
            }
          } else {
            const newMeta: ScriptMetadata = {
              name: sn.name, description: '', shell: 'powershell',
              code_hash: sha256(newCode), ids: { [hashUrl(apiUrl)]: sn.id },
              category: '', supported_platforms: [], args: [], env_vars: [],
              default_timeout: 90, run_as_user: false, syntax: '',
              favorite: false, hidden: false,
            };
            newMeta.meta_hash = computeMetaHash(newMeta);
            writeFile(filePath, buildSnippetFileContent(newCode, newMeta));
            result.pulled++;
          }
        } else {
          const newMeta: ScriptMetadata = {
            name: sn.name, description: '', shell: 'powershell',
            code_hash: sha256(newCode), ids: { [hashUrl(apiUrl)]: sn.id },
            category: '', supported_platforms: [], args: [], env_vars: [],
            default_timeout: 90, run_as_user: false, syntax: '',
            favorite: false, hidden: false,
          };
          newMeta.meta_hash = computeMetaHash(newMeta);
          writeFile(filePath, buildSnippetFileContent(newCode, newMeta));
          result.pulled++;
          result.created++;
          outputChannel.appendLine(`  📄 Created snippet: ${sn.name}`);
        }
      } catch (e: unknown) {
        result.errors.push(`Error processing snippet ${sn.name}: ${toErrorMessage(e)}`);
      }
    }

    const deleted = cleanObsoleteFiles(scriptsDir, keptFiles, outputChannel);
    result.deleted += deleted;

    const snippetsKept = new Set<string>();
    for (const sn of apiSnippets) {
      snippetsKept.add(path.join(snippetsDir, `${sanitizeName(sn.name)}.ps1`));
    }
    result.deleted += cleanObsoleteFiles(snippetsDir, snippetsKept, outputChannel);

    removeEmptyDirs(scriptsDir);
    removeEmptyDirs(snippetsDir);
  }

  const reportManifestOld: Record<string, ReportManifestEntry> = {};
  if (enableReports !== false) {
    const oldManifest = loadManifest(syncFolder);
    for (const [k, v] of Object.entries(oldManifest.files)) {
      if (v.type === 'report') {
        reportManifestOld[k] = { id: v.id, folder: v.folder! };
      }
    }
  }

  if (enableReports !== false) {
    const reportResult = await pullReportsFromApi(apiUrl, apiKey, syncFolder, outputChannel);
    result.pulled += reportResult.pulled;
    result.created += reportResult.created;
    result.deleted += reportResult.deleted;
    result.skipped += reportResult.skipped;
    result.errors.push(...reportResult.errors);
  }

  const manifest = rebuildManifestFromDisk(syncFolder, apiUrl);

  if (enableReports !== false) {
    const reportManifestNew = scanReportManifest(syncFolder, apiUrl);
    for (const [relPath, entry] of Object.entries(reportManifestNew)) {
      manifest.files[relPath] = { id: entry.id, type: 'report', folder: entry.folder };
    }
    for (const [relPath, entry] of Object.entries(reportManifestOld)) {
      if (!reportManifestNew[relPath]) {
        const deleted = await deleteReportFromApi(apiUrl, apiKey, entry.id, outputChannel);
        if (deleted) result.deleted++;
      }
    }
  }

  saveManifest(syncFolder, manifest);
  outputChannel.verbose(`  📋 Synced ${Object.keys(manifest.files).length} files in manifest`);

  if (enableGitHistory) {
    try {
      await pullGitHistory(apiUrl, apiKey, syncFolder, outputChannel);
    } catch (e: unknown) {
      result.errors.push(`Git history pull failed: ${toErrorMessage(e)}`);
    }
  }

  commitSyncChanges(syncFolder, 'pull', outputChannel);

  outputChannel.appendLine(`\n📊 Pull complete: ${result.pulled} updated, ${result.created} new, ${result.deleted} removed, ${result.skipped} skipped`);
  if (result.errors.length > 0) {
    outputChannel.appendLine(`⚠️ ${result.errors.length} errors`);
    for (const err of result.errors) {
      outputChannel.appendLine(`  ❌ ${err}`);
    }
  }

  return result;
}

export async function pushToApi(
  apiUrl: string,
  apiKey: string,
  syncFolder: string,
  outputChannel: Logger,
  _strategy: 'ask' | 'local' | 'api',
  _onConflict?: ConflictResolver,
  confirmMutation?: ConfirmMutation,
  staleStrategy?: 'overwrite' | 'skip',
  enableScripts?: boolean,
  enableReports?: boolean,
  enableGitHistory?: boolean,
): Promise<SyncResult> {
  const result: SyncResult = { pulled: 0, pushed: 0, created: 0, deleted: 0, skipped: 0, errors: [] };
  const api = new TrmmApi(apiUrl, apiKey);
  const scriptsDir = path.join(syncFolder, 'scripts');
  const manifest = loadManifest(syncFolder);

  outputChannel.appendLine('\n===== Push: Sending Changes to API =====');

  if (!fs.existsSync(scriptsDir)) {
    outputChannel.appendLine('No scripts directory found, nothing to push.');
  }

  if (enableScripts === false && enableReports === false) {
    saveManifest(syncFolder, manifest);
    return result;
  }

  if (enableScripts !== false && !fs.existsSync(scriptsDir)) {
    for (const [relPath, entry] of Object.entries(manifest.files)) {
      if (entry.type !== 'script') continue;
      if (confirmMutation && !(await confirmMutation('delete', `script: ${relPath}`))) {
        outputChannel.appendLine(`  ⏭️ Skipped delete (paranoid): ${relPath}`);
        continue;
      }
      try {
        await api.deleteScript(entry.id);
        outputChannel.appendLine(`  🗑️ Deleted on API: ${relPath} (ID: ${entry.id})`);
        result.deleted++;
      } catch (e: unknown) {
        result.errors.push(`Failed to delete ${relPath} (ID: ${entry.id}): ${toErrorMessage(e)}`);
        outputChannel.appendLine(`  ❌ Failed to delete on API: ${relPath}`);
      }
      delete manifest.files[relPath];
    }
  }

  if (enableScripts !== false && fs.existsSync(scriptsDir)) {
    const scriptFiles = findFiles(scriptsDir);
    outputChannel.verbose(`Found ${scriptFiles.length} script files to check`);

    commitSyncChanges(syncFolder, 'push', outputChannel);

    for (const filePath of scriptFiles) {
    try {
      const relPath = path.relative(syncFolder, filePath);
      const shell = inferShell(filePath);
      const content = readFile(filePath);
      if (!content) continue;

      const parsed = tryParseMetadata(content, shell);

        if (parsed) {
          const currentHash = sha256(parsed.code);
          const existingId = parsed.metadata.ids[hashUrl(apiUrl)];
          const storedHash = parsed.metadata.code_hash;
          const currentMetaHash = computeMetaHash(parsed.metadata);
          const storedMetaHash = parsed.metadata.meta_hash || '';

          if (currentHash === storedHash && currentMetaHash === storedMetaHash) {
            result.skipped++;
            continue;
          }

        if (existingId !== undefined) {
          const scriptBody = getConfig().stripMetadata !== false ? parsed.code : content;
          const payload = {
            name: parsed.metadata.name,
            description: parsed.metadata.description,
            shell: parsed.metadata.shell,
            category: parsed.metadata.category,
            script_body: scriptBody,
            args: parsed.metadata.args,
            env_vars: parsed.metadata.env_vars,
            default_timeout: parsed.metadata.default_timeout,
            run_as_user: parsed.metadata.run_as_user,
            syntax: parsed.metadata.syntax,
            favorite: parsed.metadata.favorite,
            hidden: parsed.metadata.hidden,
            supported_platforms: parsed.metadata.supported_platforms,
          };

          if (confirmMutation && !(await confirmMutation('update', `script: ${relPath}`))) {
            result.skipped++;
            outputChannel.appendLine(`  ⏭️ Skipped update (paranoid): ${relPath}`);
            continue;
          }

          // Staleness check: compare API content hash with local code_hash
          try {
            const current = await api.downloadScript(existingId);
            const apiHash = sha256(current.code);
            if (apiHash !== parsed.metadata.code_hash) {
              outputChannel.verbose(`  ⚠️ Stale: ${relPath} changed on API since last pull`);
              if ((staleStrategy ?? 'skip') === 'skip') {
                result.errors.push(`Skipped update of ${relPath}: API has changed (stale). Run pull first.`);
                outputChannel.appendLine(`  ⏭️ Skipped update (stale): ${relPath}`);
                continue;
              }
              outputChannel.verbose(`  ⚠️ Overwriting API version with local (staleStrategy=overwrite)`);
            }
          } catch (e: unknown) {
            if (e instanceof AxiosError && e.response?.status === 404) {
              outputChannel.appendLine(`  ⚠️ Script #${existingId} not found on API, will re-create`);
              if (confirmMutation && !(await confirmMutation('create', `script: ${relPath} (re-create after 404)`))) {
                result.errors.push(`Skipped re-create of ${relPath} (paranoid)`);
                outputChannel.appendLine(`  ⏭️ Skipped re-create (paranoid): ${relPath}`);
                continue;
              }
              delete parsed.metadata.ids[hashUrl(apiUrl)];
              try {
                const created = await api.createScript(payload);
                parsed.metadata.ids[hashUrl(apiUrl)] = created.id;
                parsed.metadata.code_hash = currentHash;
                parsed.metadata.meta_hash = currentMetaHash;
                writeFile(filePath, buildFileContent(parsed.code, parsed.metadata));
                result.created++;
                outputChannel.appendLine(`  ✅ Re-created: ${relPath} (new ID: ${created.id})`);
              } catch (e2: unknown) {
                const msg2 = toErrorMessage(e2);
                result.errors.push(`Failed to re-create ${relPath}: ${msg2}`);
                outputChannel.appendLine(`  ❌ ${msg2}`);
              }
              continue;
            }
            // Non-404 error fetching script; downgrade to warning, proceed with update
            outputChannel.verbose(`  ⚠️ Could not check staleness for ${relPath}: ${toErrorMessage(e)}`);
          }

          try {
            await api.updateScript(existingId, payload);
            parsed.metadata.code_hash = currentHash;
                parsed.metadata.meta_hash = currentMetaHash;
            writeFile(filePath, buildFileContent(parsed.code, parsed.metadata));
            result.pushed++;
            outputChannel.appendLine(`  📤 Updated: ${relPath}`);
          } catch (e: unknown) {
            if (e instanceof AxiosError && e.response?.status === 404) {
              outputChannel.appendLine(`  ⚠️ Script #${existingId} not found on API, will re-create`);
              if (confirmMutation && !(await confirmMutation('create', `script: ${relPath} (re-create after 404)`))) {
                result.errors.push(`Skipped re-create of ${relPath} (paranoid)`);
                outputChannel.appendLine(`  ⏭️ Skipped re-create (paranoid): ${relPath}`);
                continue;
              }
              delete parsed.metadata.ids[hashUrl(apiUrl)];
              try {
                const created = await api.createScript(payload);
                parsed.metadata.ids[hashUrl(apiUrl)] = created.id;
                parsed.metadata.code_hash = currentHash;
                parsed.metadata.meta_hash = currentMetaHash;
                writeFile(filePath, buildFileContent(parsed.code, parsed.metadata));
                result.created++;
                outputChannel.appendLine(`  ✅ Re-created: ${relPath} (new ID: ${created.id})`);
              } catch (e2: unknown) {
                const msg2 = toErrorMessage(e2);
                result.errors.push(`Failed to re-create ${relPath}: ${msg2}`);
                outputChannel.appendLine(`  ❌ ${msg2}`);
              }
              continue;
            } else {
              const msg = toErrorMessage(e);
              result.errors.push(`Failed to update ${relPath}: ${msg}`);
              outputChannel.appendLine(`  ❌ ${msg}`);
            }
          }
        } else {
          const scriptBody = getConfig().stripMetadata !== false ? parsed.code : content;
          const payload = {
            name: parsed.metadata.name,
            description: parsed.metadata.description,
            shell: parsed.metadata.shell,
            category: parsed.metadata.category,
            script_body: scriptBody,
            args: parsed.metadata.args,
            env_vars: parsed.metadata.env_vars,
            default_timeout: parsed.metadata.default_timeout,
            run_as_user: parsed.metadata.run_as_user,
            syntax: parsed.metadata.syntax,
            favorite: parsed.metadata.favorite,
            hidden: parsed.metadata.hidden,
            supported_platforms: parsed.metadata.supported_platforms,
          };

          if (confirmMutation && !(await confirmMutation('create', `script: ${relPath}`))) {
            result.skipped++;
            outputChannel.appendLine(`  ⏭️ Skipped create (paranoid): ${relPath}`);
            continue;
          }
          try {
            const created = await api.createScript(payload);
            parsed.metadata.ids[hashUrl(apiUrl)] = created.id;
            parsed.metadata.code_hash = currentHash;
                parsed.metadata.meta_hash = currentMetaHash;
            writeFile(filePath, buildFileContent(parsed.code, parsed.metadata));
            result.created++;
            outputChannel.appendLine(`  ✅ Created on API: ${relPath} (ID: ${created.id})`);
          } catch (e: unknown) {
            const msg = toErrorMessage(e);
            result.errors.push(`Failed to create ${relPath}: ${msg}`);
            outputChannel.appendLine(`  ❌ ${msg}`);
          }
        }
      } else {
        const rawContent = content.trim();
        if (!rawContent) { result.skipped++; continue; }

        const shell = inferShell(filePath);
        const name = path.basename(filePath, path.extname(filePath));
        const relDir = path.relative(scriptsDir, path.dirname(filePath));

        const payload = {
          name,
          description: '',
          shell,
          category: relDir === '.' ? '' : relDir,
          script_body: rawContent,
          args: [],
          env_vars: [],
          default_timeout: 90,
          run_as_user: false,
          syntax: '',
          favorite: false,
          hidden: false,
          supported_platforms: [],
        };

        if (confirmMutation && !(await confirmMutation('create', `script: ${relPath}`))) {
          result.skipped++;
          outputChannel.appendLine(`  ⏭️ Skipped create (paranoid): ${relPath}`);
          continue;
        }
        try {
          const created = await api.createScript(payload);
          const newMeta: ScriptMetadata = {
            name,
            description: '',
            shell,
            category: relDir === '.' ? '' : relDir,
            supported_platforms: [],
            args: [],
            env_vars: [],
            default_timeout: 90,
            run_as_user: false,
            syntax: '',
            favorite: false,
            hidden: false,
            code_hash: sha256(rawContent),
            ids: { [hashUrl(apiUrl)]: created.id },
          };
          newMeta.meta_hash = computeMetaHash(newMeta);
          writeFile(filePath, buildFileContent(rawContent, newMeta));
          result.created++;
          outputChannel.appendLine(`  ✅ Created (no metadata): ${relPath} (ID: ${created.id})`);
        } catch (e: unknown) {
          const msg = toErrorMessage(e);
          result.errors.push(`Failed to create ${relPath}: ${msg}`);
          outputChannel.appendLine(`  ❌ ${msg}`);
        }
      }
    } catch (e: unknown) {
      const msg = toErrorMessage(e);
      result.errors.push(`Error processing ${filePath}: ${msg}`);
      outputChannel.appendLine(`  ❌ ${msg}`);
    }
  }
  }

  if (enableReports !== false) {
    const reportResult = await pushReportsToApi(apiUrl, apiKey, syncFolder, outputChannel, confirmMutation, staleStrategy);
    result.pushed += reportResult.pushed;
    result.created += reportResult.created;
    result.deleted += reportResult.deleted;
    result.skipped += reportResult.skipped;
    result.errors.push(...reportResult.errors);
  }

  const newManifest = rebuildManifestFromDisk(syncFolder, apiUrl);

  if (enableScripts !== false) {
    for (const [relPath, entry] of Object.entries(manifest.files)) {
      if (entry.type !== 'script') continue;
      if (!newManifest.files[relPath]) {
        if (confirmMutation && !(await confirmMutation('delete', `script: ${relPath}`))) {
          outputChannel.appendLine(`  ⏭️ Skipped delete (paranoid): ${relPath}`);
          continue;
        }
        try {
          await api.deleteScript(entry.id);
          outputChannel.appendLine(`  🗑️ Deleted on API: ${relPath} (ID: ${entry.id})`);
          result.deleted++;
      } catch (e: unknown) {
        result.errors.push(`Failed to delete ${relPath} (ID: ${entry.id}): ${toErrorMessage(e)}`);
        outputChannel.appendLine(`  ❌ Failed to delete on API: ${relPath}`);
      }
    }
    }
  }

  if (enableReports !== false) {
    const reportManifestOld: Record<string, ReportManifestEntry> = {};
    for (const [k, v] of Object.entries(manifest.files)) {
      if (v.type === 'report') {
        reportManifestOld[k] = { id: v.id, folder: v.folder! };
      }
    }
    const reportManifestNew = scanReportManifest(syncFolder, apiUrl);
    for (const [relPath, entry] of Object.entries(reportManifestOld)) {
      if (!reportManifestNew[relPath]) {
        const deleted = await deleteReportFromApi(apiUrl, apiKey, entry.id, outputChannel, confirmMutation);
        if (deleted) result.deleted++;
      }
    }
    for (const [relPath, entry] of Object.entries(reportManifestNew)) {
      newManifest.files[relPath] = { id: entry.id, type: 'report', folder: entry.folder };
    }
  }

  for (const [relPath, entry] of Object.entries(manifest.files)) {
    if (entry.type !== 'snippet') continue;
    if (!newManifest.files[relPath]) {
      newManifest.files[relPath] = entry;
    }
  }

  saveManifest(syncFolder, newManifest);
  outputChannel.verbose(`  📋 Synced ${Object.keys(newManifest.files).length} files in manifest`);

  if (enableGitHistory) {
    try {
      await pushGitHistory(apiUrl, apiKey, syncFolder, outputChannel);
    } catch (e: unknown) {
      result.errors.push(`Git history push failed: ${toErrorMessage(e)}`);
    }
  }

  outputChannel.appendLine(`\n📊 Push complete: ${result.pushed} updated, ${result.created} created, ${result.deleted} deleted, ${result.skipped} skipped`);
  if (result.errors.length > 0) {
    outputChannel.appendLine(`⚠️ ${result.errors.length} errors`);
    for (const err of result.errors) {
      outputChannel.appendLine(`  ❌ ${err}`);
    }
  }

  return result;
}

export function findFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      results.push(...findFiles(full));
    } else if (entry.isFile() && isScriptFile(full)) {
      results.push(full);
    }
  }
  return results;
}

function cleanObsoleteFiles(dir: string, keptFiles: Set<string>, outputChannel: Logger): number {
  let deleted = 0;
  if (!fs.existsSync(dir)) return 0;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      deleted += cleanObsoleteFiles(full, keptFiles, outputChannel);
    } else if (entry.isFile() && !keptFiles.has(full) && isScriptFile(full)) {
      deleteFile(full);
      deleted++;
      outputChannel.appendLine(`  🗑️ Removed obsolete: ${path.relative(dir, full)}`);
    }
  }
  return deleted;
}

async function resolveConflict(
  _filePath: string,
  _direction: 'pull' | 'push',
  strategy: 'ask' | 'local' | 'api',
  onConflict?: ConflictResolver,
  localContent?: string,
  apiContent?: string,
): Promise<'local' | 'api' | 'local-all' | 'api-all'> {
  if (strategy !== 'ask') return strategy;
  if (onConflict) return onConflict(_filePath, _direction, localContent, apiContent);
  return 'api';
}
