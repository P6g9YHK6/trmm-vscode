import * as fs from 'fs';
import * as path from 'path';
import { sha256, hashUrl } from './hash';
import { sanitizeName } from '../utils/pathBuilder';
import { Logger, toErrorMessage } from '../logger';
import { TrmmApi, ReportTemplate, ReportPayload, ReportTemplateType } from '../api/trmmApi';

export function templateExtension(type: ReportTemplateType): string {
  if (type === 'markdown') return '.md';
  if (type === 'html') return '.html';
  return '.txt';
}

export interface ReportMeta {
  name: string;
  type: ReportTemplateType;
  depends_on: string[];
  template_html: number | null;
  ids: Record<string, number>;
  code_hash: string;
}

export interface ReportContent {
  template_md: string;
  template_css: string;
  template_variables: string;
}

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

export function computeReportHash(template_md: string, template_css: string, template_variables: string): string {
  return sha256(template_md + '|||' + template_css + '|||' + template_variables);
}

export function buildReportFolder(syncFolder: string, name: string): string {
  return path.join(syncFolder, 'reports', sanitizeName(name));
}

function metaPath(reportFolder: string): string {
  return path.join(reportFolder, 'meta.json');
}

function templatePath(reportFolder: string, type?: ReportTemplateType): string {
  return path.join(reportFolder, `template${type ? templateExtension(type) : '.j2'}`);
}

function stylePath(reportFolder: string): string {
  return path.join(reportFolder, 'style.css');
}

function variablesPath(reportFolder: string): string {
  return path.join(reportFolder, 'variables.yaml');
}

export function writeReportFiles(reportFolder: string, meta: ReportMeta, content: ReportContent): void {
  ensureDir(reportFolder);
  const mp = metaPath(reportFolder);
  if (fs.existsSync(mp)) {
    try {
      JSON.parse(fs.readFileSync(mp, 'utf-8'));
    } catch {
      // Existing meta.json is corrupted — back it up before overwriting
      fs.cpSync(mp, mp + '.bak', { force: true });
    }
  }
  writeFile(mp, JSON.stringify(meta, null, 2));
  writeFile(templatePath(reportFolder, meta.type), content.template_md);
  writeFile(stylePath(reportFolder), content.template_css);
  writeFile(variablesPath(reportFolder), content.template_variables);
}

export function readReportFiles(reportFolder: string): { meta: ReportMeta; content: ReportContent } | null {
  const metaRaw = readFile(metaPath(reportFolder));
  if (!metaRaw) return null;

  let meta: ReportMeta;
  try {
    meta = JSON.parse(metaRaw);
  } catch {
    return null;
  }

  const template_md = readFile(templatePath(reportFolder, meta.type))
    ?? readFile(templatePath(reportFolder))
    ?? '';
  const template_css = readFile(stylePath(reportFolder)) ?? '';
  const template_variables = readFile(variablesPath(reportFolder)) ?? '';

  return { meta, content: { template_md, template_css, template_variables } };
}

export async function pullReportsFromApi(
  apiUrl: string,
  apiKey: string,
  syncFolder: string,
  outputChannel: Logger,
): Promise<{ pulled: number; created: number; deleted: number; skipped: number; errors: string[] }> {
  const result = { pulled: 0, created: 0, deleted: 0, skipped: 0, errors: [] as string[] };
  const api = new TrmmApi(apiUrl, apiKey);
  const reportsDir = path.join(syncFolder, 'reports');

  outputChannel.appendLine('\n===== Pull: Fetching Reports =====');
  outputChannel.verbose(`GET ${api.apiUrl}/reporting/templates/`);

  let apiReports: ReportTemplate[];
  try {
    apiReports = await api.fetchReportTemplates();
    outputChannel.verbose(`Found ${apiReports.length} reports on API`);
  } catch (e: unknown) {
    const msg = toErrorMessage(e);
    result.errors.push(`Failed to fetch reports: ${msg}`);
    outputChannel.appendLine(`❌ ${msg}`);
    return result;
  }

  const keptFiles = new Set<string>();

  for (const r of apiReports) {
    try {
      const reportFolder = buildReportFolder(syncFolder, r.name);
      const metaFile = metaPath(reportFolder);
      keptFiles.add(metaFile);

      const content: ReportContent = {
        template_md: r.template_md,
        template_css: r.template_css,
        template_variables: r.template_variables,
      };

      const currentHash = computeReportHash(content.template_md, content.template_css, content.template_variables);
      const existingMeta = readFile(metaFile);

      if (existingMeta !== null) {
        try {
          const existing: ReportMeta = JSON.parse(existingMeta);
          if (existing.code_hash === currentHash) {
            existing.ids[hashUrl(apiUrl)] = r.id;
            writeFile(metaFile, JSON.stringify(existing, null, 2));
            result.skipped++;
            continue;
          }
        } catch { /* parse error, rewrite */ }
      }

      const meta: ReportMeta = {
        name: r.name,
        type: r.type,
        depends_on: r.depends_on || [],
        template_html: r.template_html,
        ids: { [hashUrl(apiUrl)]: r.id },
        code_hash: currentHash,
      };

      writeReportFiles(reportFolder, meta, content);
      outputChannel.appendLine(`  📄 ${r.name} (${r.type})`);
      result.pulled++;
      if (existingMeta === null) result.created++;
    } catch (e: unknown) {
      result.errors.push(`Error processing report ${r.name}: ${toErrorMessage(e)}`);
    }
  }

  if (fs.existsSync(reportsDir)) {
    const existing = fs.readdirSync(reportsDir, { withFileTypes: true });
    for (const entry of existing) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;
      const metaFile = path.join(reportsDir, entry.name, 'meta.json');
      if (!keptFiles.has(metaFile)) {
        const metaRaw = readFile(metaFile);
        let shouldDelete = true;
        if (metaRaw) {
          try {
            const meta: ReportMeta = JSON.parse(metaRaw);
            const otherApis = Object.keys(meta.ids).filter(h => h !== hashUrl(apiUrl));
            shouldDelete = otherApis.length === 0;
          } catch { /* ok */ }
        }
        if (shouldDelete) {
          deleteFile(metaFile);
          for (const ext of ['.j2', '.md', '.html', '.txt']) {
            deleteFile(path.join(reportsDir, entry.name, `template${ext}`));
          }
          deleteFile(path.join(reportsDir, entry.name, 'style.css'));
          deleteFile(path.join(reportsDir, entry.name, 'variables.yaml'));
          removeEmptyDirs(path.join(reportsDir, entry.name));
          outputChannel.appendLine(`  🗑️ Removed obsolete: reports/${entry.name}`);
          result.deleted++;
        }
      }
    }
  }

  return result;
}

export async function pushReportsToApi(
  apiUrl: string,
  apiKey: string,
  syncFolder: string,
  outputChannel: Logger,
  confirmMutation?: (type: 'create' | 'update' | 'delete', description: string) => Promise<boolean>,
  _staleStrategy: 'skip' | 'overwrite' = 'skip',
): Promise<{ pushed: number; created: number; deleted: number; skipped: number; errors: string[] }> {
  const result = { pushed: 0, created: 0, deleted: 0, skipped: 0, errors: [] as string[] };
  const api = new TrmmApi(apiUrl, apiKey);
  const reportsDir = path.join(syncFolder, 'reports');

  outputChannel.appendLine('\n----- Push: Reports -----');

  if (!fs.existsSync(reportsDir)) {
    outputChannel.appendLine('No reports directory found, skipping.');
    return result;
  }

  const entries = fs.readdirSync(reportsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;

    const reportFolder = path.join(reportsDir, entry.name);
    const parsed = readReportFiles(reportFolder);
    if (!parsed) {
      outputChannel.appendLine(`  ⚠️ Skipping reports/${entry.name}: could not read meta.json`);
      result.skipped++;
      continue;
    }

    const { meta, content } = parsed;
    const currentHash = computeReportHash(content.template_md, content.template_css, content.template_variables);

    if (currentHash === meta.code_hash) {
      result.skipped++;
      continue;
    }

    const existingId = meta.ids[hashUrl(apiUrl)];

    if (existingId !== undefined) {
      const payload: Partial<ReportPayload> = {
        name: meta.name,
        template_md: content.template_md,
        template_css: content.template_css,
        template_variables: content.template_variables,
        type: meta.type,
        depends_on: meta.depends_on,
        template_html: meta.template_html,
      };

      if (confirmMutation && !(await confirmMutation('update', `report: ${meta.name}`))) {
        result.skipped++;
        outputChannel.appendLine(`  ⏭️ Skipped update (paranoid): reports/${entry.name}`);
        continue;
      }

      // Staleness check: fetch current API report and compare hashes
      try {
        const apiReport = await api.getReportTemplate(existingId);
        const apiHash = computeReportHash(apiReport.template_md, apiReport.template_css, apiReport.template_variables);
        if (apiHash !== meta.code_hash) {
          const stalenessCheck = _staleStrategy ?? 'skip';
          if (stalenessCheck === 'skip') {
            result.skipped++;
            outputChannel.appendLine(`  ⏭️ Skipped update (stale): reports/${entry.name} (API has been modified since last pull)`);
            continue;
          }
          outputChannel.appendLine(`  ⚠️ API has newer version of reports/${entry.name}; proceeding with overwrite`);
        }
      } catch {
        outputChannel.appendLine(`  ⚠️ Could not check staleness for reports/${entry.name}; proceeding with update`);
      }

      try {
        await api.updateReportTemplate(existingId, payload);
        meta.code_hash = currentHash;
        writeReportFiles(reportFolder, meta, content);
        result.pushed++;
        outputChannel.appendLine(`  📤 Updated: reports/${entry.name}`);
      } catch (e: unknown) {
        result.errors.push(`Failed to update report ${meta.name}: ${toErrorMessage(e)}`);
        outputChannel.appendLine(`  ❌ Failed to update: reports/${entry.name}`);
      }
    } else {
      const payload: ReportPayload = {
        name: meta.name,
        template_md: content.template_md,
        template_css: content.template_css,
        template_variables: content.template_variables,
        type: meta.type,
        depends_on: meta.depends_on,
        template_html: meta.template_html ?? null,
      };

      if (confirmMutation && !(await confirmMutation('create', `report: ${meta.name}`))) {
        result.skipped++;
        outputChannel.appendLine(`  ⏭️ Skipped create (paranoid): reports/${entry.name}`);
        continue;
      }

      try {
        const created = await api.createReportTemplate(payload);
        meta.ids[hashUrl(apiUrl)] = created.id;
        meta.code_hash = currentHash;
        writeReportFiles(reportFolder, meta, content);
        result.created++;
        outputChannel.appendLine(`  ✅ Created: reports/${entry.name} (ID: ${created.id})`);
      } catch (e: unknown) {
        result.errors.push(`Failed to create report ${meta.name}: ${toErrorMessage(e)}`);
        outputChannel.appendLine(`  ❌ Failed to create: reports/${entry.name}`);
      }
    }
  }

  return result;
}

export async function deleteReportFromApi(
  apiUrl: string,
  apiKey: string,
  apiId: number,
  outputChannel: Logger,
  confirmMutation?: (type: 'create' | 'update' | 'delete', description: string) => Promise<boolean>,
): Promise<boolean> {
  if (confirmMutation && !(await confirmMutation('delete', `report: #${apiId}`))) {
    outputChannel.appendLine(`  ⏭️ Skipped delete (paranoid): report #${apiId}`);
    return false;
  }
  const api = new TrmmApi(apiUrl, apiKey);
  try {
    await api.deleteReportTemplate(apiId);
    return true;
  } catch (e: unknown) {
    outputChannel.appendLine(`  ❌ Failed to delete report #${apiId}: ${toErrorMessage(e)}`);
    return false;
  }
}

export interface ReportManifestEntry {
  id: number;
  folder: string;
}

export function scanReportManifest(syncFolder: string, apiUrl: string): Record<string, ReportManifestEntry> {
  const manifest: Record<string, ReportManifestEntry> = {};
  const reportsDir = path.join(syncFolder, 'reports');
  if (!fs.existsSync(reportsDir)) return manifest;

  const entries = fs.readdirSync(reportsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    const reportFolder = path.join(reportsDir, entry.name);
    const parsed = readReportFiles(reportFolder);
    if (!parsed) continue;
    const id = parsed.meta.ids[hashUrl(apiUrl)];
    if (id === undefined) continue;
    const relPath = path.relative(syncFolder, path.join(reportFolder, 'meta.json'));
    manifest[relPath] = { id, folder: entry.name };
  }
  return manifest;
}