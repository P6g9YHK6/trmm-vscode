import * as fs from 'fs';
import * as path from 'path';
import { TrmmApi, ScriptHeader, ScriptDownload, SnippetHeader } from '../api/trmmApi';
import { parseMetadata, parseBlockCommentMetadata, buildFileContent, ScriptMetadata } from './metadata';
import { sha256, hashUrl } from './hash';
import { buildScriptPath, sanitizeName, inferShell, isScriptFile } from '../utils/pathBuilder';
import { Logger, toErrorMessage } from '../logger';
import { AxiosError } from 'axios';

export interface SyncResult {
  pulled: number;
  pushed: number;
  created: number;
  deleted: number;
  skipped: number;
  errors: string[];
}

export type ConflictResolver = (filePath: string, direction: 'pull' | 'push') => Promise<'local' | 'api'>;

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

export async function pullFromApi(
  apiUrl: string,
  apiKey: string,
  syncFolder: string,
  outputChannel: Logger,
  strategy: 'ask' | 'local' | 'api',
  onConflict?: ConflictResolver
): Promise<SyncResult> {
  const result: SyncResult = { pulled: 0, pushed: 0, created: 0, deleted: 0, skipped: 0, errors: [] };
  const api = new TrmmApi(apiUrl, apiKey);
  const scriptsDir = path.join(syncFolder, 'scripts');
  const snippetsDir = path.join(syncFolder, 'snippets');

  ensureDir(scriptsDir);
  ensureDir(snippetsDir);

  outputChannel.appendLine('\n===== Pull: Fetching Scripts =====');
  outputChannel.appendLine(`GET ${api.apiUrl}/scripts/?showHiddenScripts=true`);

  let apiScripts: ScriptHeader[];
  try {
    apiScripts = await api.fetchScripts();
    outputChannel.appendLine(`Found ${apiScripts.length} scripts on API`);
  } catch (e: unknown) {
    const msg = toErrorMessage(e);
    result.errors.push(`Failed to fetch scripts: ${msg}`);
    outputChannel.appendLine(`❌ ${msg}`);
    if (e instanceof AxiosError && e.response) {
      outputChannel.appendLine(`HTTP ${e.response.status}: ${JSON.stringify(e.response.data).slice(0, 500)}`);
    }
    outputChannel.appendLine('Debug: Check that your API URL and key are correct.');
    return result;
  }

  const keptFiles = new Set<string>();

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

      const newCode = download.code;
      const existing = readFile(filePath);

      if (existing !== null) {
        const parsed = tryParseMetadata(existing, s.shell);
        if (parsed) {
          const existingHash = sha256(parsed.code);
          const newHash = sha256(newCode);

          if (existingHash === parsed.metadata.code_hash && existingHash !== newHash) {
            writeFile(filePath, buildFileContent(newCode, {
              ...parsed.metadata,
              code_hash: newHash,
              ids: { ...parsed.metadata.ids, [hashUrl(apiUrl)]: s.id },
            }));
            result.pulled++;
            outputChannel.appendLine(`  📥 Updated: ${s.category}/${s.name}`);
          } else if (existingHash !== parsed.metadata.code_hash && existingHash !== newHash) {
            const action = await resolveConflict(filePath, 'pull', strategy, onConflict);
            if (action === 'api') {
              writeFile(filePath, buildFileContent(newCode, {
                ...parsed.metadata,
                code_hash: newHash,
                ids: { ...parsed.metadata.ids, [hashUrl(apiUrl)]: s.id },
              }));
              result.pulled++;
              outputChannel.appendLine(`  📥 Overwrote local (API won): ${s.category}/${s.name}`);
            } else {
              result.skipped++;
              outputChannel.appendLine(`  ⏭️ Kept local: ${s.category}/${s.name}`);
            }
          } else {
            result.skipped++;
          }
        } else {
          const newMeta: ScriptMetadata = {
            name: s.name,
            description: s.description || '',
            shell: s.shell,
            category: s.category || '',
            supported_platforms: s.supported_platforms || [],
            args: s.args || [],
            env_vars: s.env_vars || [],
            default_timeout: s.default_timeout || 90,
            run_as_user: s.run_as_user || false,
            syntax: s.syntax || '',
            favorite: s.favorite || false,
            hidden: s.hidden || false,
            code_hash: sha256(newCode),
            ids: { [hashUrl(apiUrl)]: s.id },
          };
          writeFile(filePath, buildFileContent(newCode, newMeta));
          result.pulled++;
          outputChannel.appendLine(`  📥 Added metadata to existing file: ${s.category}/${s.name}`);
        }
      } else {
        const newMeta: ScriptMetadata = {
          name: s.name,
          description: s.description || '',
          shell: s.shell,
          category: s.category || '',
          supported_platforms: s.supported_platforms || [],
          args: s.args || [],
          env_vars: s.env_vars || [],
          default_timeout: s.default_timeout || 90,
          run_as_user: s.run_as_user || false,
          syntax: s.syntax || '',
          favorite: s.favorite || false,
          hidden: s.hidden || false,
          code_hash: sha256(newCode),
          ids: { [hashUrl(apiUrl)]: s.id },
        };
        writeFile(filePath, buildFileContent(newCode, newMeta));
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

  outputChannel.appendLine('\n----- Pull: Snippets -----');

  let apiSnippets: SnippetHeader[];
  try {
    apiSnippets = await api.fetchSnippets();
    outputChannel.appendLine(`Found ${apiSnippets.length} snippets on API`);
  } catch (e: unknown) {
    result.errors.push(`Failed to fetch snippets: ${toErrorMessage(e)}`);
    return result;
  }

  for (const sn of apiSnippets) {
    try {
      const filePath = path.join(snippetsDir, `${sanitizeName(sn.name)}.ps1`);
      keptFiles.add(filePath);

      const newCode = sn.code;
      const existing = readFile(filePath);

      if (existing !== null) {
        const parsed = tryParseMetadata(existing, 'powershell');
        if (parsed) {
          const existingHash = sha256(parsed.code);
          const newHash = sha256(newCode);

          if (existingHash === parsed.metadata.code_hash && existingHash !== newHash) {
            writeFile(filePath, buildFileContent(newCode, {
              ...parsed.metadata,
              code_hash: newHash,
              ids: { ...parsed.metadata.ids, [apiUrl]: sn.id },
            }));
            result.pulled++;
            outputChannel.appendLine(`  📥 Updated snippet: ${sn.name}`);
          } else if (existingHash !== parsed.metadata.code_hash && existingHash !== newHash) {
            const action = await resolveConflict(filePath, 'pull', strategy, onConflict);
            if (action === 'api') {
              writeFile(filePath, buildFileContent(newCode, {
                ...parsed.metadata,
                code_hash: newHash,
                ids: { ...parsed.metadata.ids, [apiUrl]: sn.id },
              }));
              result.pulled++;
            } else {
              result.skipped++;
            }
          } else {
            result.skipped++;
          }
        } else {
          writeFile(filePath, buildFileContent(newCode, {
            name: sn.name,
            description: '',
            shell: 'powershell',
            category: '',
            supported_platforms: [],
            args: [],
            env_vars: [],
            default_timeout: 90,
            run_as_user: false,
            syntax: '',
            favorite: false,
            hidden: false,
            code_hash: sha256(newCode),
            ids: { [apiUrl]: sn.id },
          }));
          result.pulled++;
        }
      } else {
        writeFile(filePath, buildFileContent(newCode, {
          name: sn.name,
          description: '',
          shell: 'powershell',
          category: '',
          supported_platforms: [],
          args: [],
          env_vars: [],
          default_timeout: 90,
          run_as_user: false,
          syntax: '',
          favorite: false,
          hidden: false,
          code_hash: sha256(newCode),
          ids: { [apiUrl]: sn.id },
        }));
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

  outputChannel.appendLine(`\n📊 Pull complete: ${result.pulled} updated, ${result.created} new, ${result.deleted} removed, ${result.skipped} skipped`);
  if (result.errors.length > 0) {
    outputChannel.appendLine(`⚠️ ${result.errors.length} errors`);
  }

  return result;
}

export async function pushToApi(
  apiUrl: string,
  apiKey: string,
  syncFolder: string,
  outputChannel: Logger,
  _strategy: 'ask' | 'local' | 'api',
  _onConflict?: ConflictResolver
): Promise<SyncResult> {
  const result: SyncResult = { pulled: 0, pushed: 0, created: 0, deleted: 0, skipped: 0, errors: [] };
  const api = new TrmmApi(apiUrl, apiKey);
  const scriptsDir = path.join(syncFolder, 'scripts');

  outputChannel.appendLine('\n===== Push: Sending Changes to API =====');

  if (!fs.existsSync(scriptsDir)) {
    outputChannel.appendLine('No scripts directory found, nothing to push.');
    return result;
  }

  const scriptFiles = findFiles(scriptsDir);
  outputChannel.appendLine(`Found ${scriptFiles.length} script files to check`);

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

        if (currentHash === storedHash) {
          result.skipped++;
          continue;
        }

        if (existingId !== undefined) {
          const payload = {
            name: parsed.metadata.name,
            description: parsed.metadata.description,
            shell: parsed.metadata.shell,
            category: parsed.metadata.category,
            script_body: parsed.code,
            args: parsed.metadata.args,
            env_vars: parsed.metadata.env_vars,
            default_timeout: parsed.metadata.default_timeout,
            run_as_user: parsed.metadata.run_as_user,
            syntax: parsed.metadata.syntax,
            favorite: parsed.metadata.favorite,
            hidden: parsed.metadata.hidden,
            supported_platforms: parsed.metadata.supported_platforms,
          };

          try {
            await api.updateScript(existingId, payload);
            parsed.metadata.code_hash = currentHash;
            writeFile(filePath, buildFileContent(parsed.code, parsed.metadata));
            result.pushed++;
            outputChannel.appendLine(`  📤 Updated: ${relPath}`);
          } catch (e: unknown) {
            if (e instanceof AxiosError && e.response?.status === 404) {
              outputChannel.appendLine(`  ⚠️ Script #${existingId} not found on API, will re-create`);
              delete parsed.metadata.ids[hashUrl(apiUrl)];
              try {
                const created = await api.createScript(payload);
                parsed.metadata.ids[hashUrl(apiUrl)] = created.id;
                parsed.metadata.code_hash = currentHash;
                writeFile(filePath, buildFileContent(parsed.code, parsed.metadata));
                result.created++;
                outputChannel.appendLine(`  ✅ Re-created: ${relPath} (new ID: ${created.id})`);
              } catch (e2: unknown) {
                const msg2 = toErrorMessage(e2);
                result.errors.push(`Failed to re-create ${relPath}: ${msg2}`);
                outputChannel.appendLine(`  ❌ ${msg2}`);
              }
            } else {
              const msg = toErrorMessage(e);
              result.errors.push(`Failed to update ${relPath}: ${msg}`);
              outputChannel.appendLine(`  ❌ ${msg}`);
            }
          }
        } else {
          const payload = {
            name: parsed.metadata.name,
            description: parsed.metadata.description,
            shell: parsed.metadata.shell,
            category: parsed.metadata.category,
            script_body: parsed.code,
            args: parsed.metadata.args,
            env_vars: parsed.metadata.env_vars,
            default_timeout: parsed.metadata.default_timeout,
            run_as_user: parsed.metadata.run_as_user,
            syntax: parsed.metadata.syntax,
            favorite: parsed.metadata.favorite,
            hidden: parsed.metadata.hidden,
            supported_platforms: parsed.metadata.supported_platforms,
          };

          try {
            const created = await api.createScript(payload);
            parsed.metadata.ids[hashUrl(apiUrl)] = created.id;
            parsed.metadata.code_hash = currentHash;
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
            ids: { [apiUrl]: created.id },
          };
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

  outputChannel.appendLine(`\n📊 Push complete: ${result.pushed} updated, ${result.created} created, ${result.skipped} skipped`);
  if (result.errors.length > 0) {
    outputChannel.appendLine(`⚠️ ${result.errors.length} errors`);
  }

  return result;
}

function findFiles(dir: string): string[] {
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
  onConflict?: ConflictResolver
): Promise<'local' | 'api'> {
  if (strategy !== 'ask') return strategy;
  if (onConflict) return onConflict(_filePath, _direction);
  return 'api';
}
