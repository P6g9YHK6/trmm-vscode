import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { getConfig, validateConfig } from '../utils/config';
import { buildScriptPath, inferShell, isScriptFile } from '../utils/pathBuilder';
import { parseMetadata, buildFileContent, ScriptMetadata } from '../sync/metadata';
import { sha256 } from '../sync/hash';
import { readReportFiles, templateExtension } from '../sync/reportSync';

function extractOrgFromUrl(url: string): string {
  let cleaned = url.replace(/^git@/, '').replace(/^https?:\/\//, '').replace(/^ssh:\/\//, '').replace(/\.git$/, '');
  const colonIdx = cleaned.indexOf(':');
  const slashIdx = cleaned.indexOf('/');
  if (colonIdx > 0 && (slashIdx < 0 || colonIdx < slashIdx)) {
    cleaned = cleaned.slice(colonIdx + 1);
  } else {
    const hostEnd = cleaned.indexOf('/');
    if (hostEnd >= 0) cleaned = cleaned.slice(hostEnd + 1);
  }
  const parts = cleaned.split('/');
  parts.pop();
  return parts.join('/') || 'unknown';
}

function getRelativeDir(filePath: string, baseDir: string): string {
  const rel = path.relative(baseDir, path.dirname(filePath));
  return rel === '' || rel === '.' ? '' : rel;
}

function generateName(parsed: { code: string; metadata: ScriptMetadata } | null, filePath: string): string {
  if (parsed && parsed.metadata.name) return parsed.metadata.name;
  return path.basename(filePath, path.extname(filePath));
}

async function promptForRepoUrl(): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: 'Git repo URL (any format: https, ssh, git://)',
    placeHolder: 'https://github.com/acme-sre/toolkit.git',
    validateInput: (v: string) => v.trim().length > 0 ? null : 'URL is required',
  });
}

async function promptForSubfolder(): Promise<string> {
  const val = await vscode.window.showInputBox({
    prompt: 'Subfolder within repo to import (leave empty for root)',
    placeHolder: 'scripts/linux/',
  });
  return (val || '').replace(/^\/+|\/+$/g, '');
}

export function registerImportFromGitCommand(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
  context.subscriptions.push(
    vscode.commands.registerCommand('trmm.importFromGit', async () => {
      const config = getConfig();
      const err = validateConfig(config);
      if (err) {
        vscode.window.showErrorMessage(`TRMM: ${err}. Configure in settings.`);
        return;
      }

      const repoUrl = await promptForRepoUrl();
      if (!repoUrl) return;

      const subfolder = await promptForSubfolder();
      const org = extractOrgFromUrl(repoUrl);

      const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'trmm-import-'));
      outputChannel.show(true);
      outputChannel.appendLine(`\n📥 Importing from ${repoUrl}`);
      outputChannel.appendLine(`   Org: ${org}, Subfolder: /${subfolder}`);

      try {
        outputChannel.appendLine('   Cloning...');
        execSync(`git clone --depth 1 "${repoUrl}" "${tmpDir}"`, { stdio: 'pipe', timeout: 60000 });

        const targetDir = subfolder ? path.join(tmpDir, subfolder) : tmpDir;
        if (!fs.existsSync(targetDir)) {
          vscode.window.showErrorMessage(`Subfolder "${subfolder}" not found in repo`);
          return;
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

              if (parsed && parsed.metadata.category && parsed.metadata.category.trim()) {
                catParts.push(parsed.metadata.category);
              } else if (relDir) {
                catParts.push(relDir);
              } else {
                catParts.push('uncategorised');
              }

              const category = catParts.join('/');
              let destPath = buildScriptPath(config.syncFolder, name, category, shell);
              let finalName = name;

              if (fs.existsSync(destPath)) {
                finalName = `${name}-${org}`;
                destPath = buildScriptPath(config.syncFolder, finalName, category, shell);
                renamed.push(`${name} → ${finalName}`);
                if (fs.existsSync(destPath)) {
                  skipped.push(finalName);
                  continue;
                }
              }

              const newMeta: ScriptMetadata = {
                name: finalName,
                description: parsed?.metadata.description || '',
                shell,
                category,
                supported_platforms: parsed?.metadata.supported_platforms || [],
                args: parsed?.metadata.args || [],
                env_vars: parsed?.metadata.env_vars || [],
                default_timeout: parsed?.metadata.default_timeout ?? 90,
                run_as_user: parsed?.metadata.run_as_user ?? false,
                syntax: parsed?.metadata.syntax || '',
                favorite: parsed?.metadata.favorite ?? false,
                hidden: parsed?.metadata.hidden ?? false,
                code_hash: sha256(content),
                ids: {},
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
          const reportEntries = fs.readdirSync(reportsSrcDir, { withFileTypes: true });
          for (const entry of reportEntries) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
            const srcReportFolder = path.join(reportsSrcDir, entry.name);
            const parsed = readReportFiles(srcReportFolder);
            if (!parsed) {
              skipped.push(`reports/${entry.name} (invalid meta.json)`);
              continue;
            }
            let destFolder = path.join(config.syncFolder, 'reports', entry.name);
            if (fs.existsSync(destFolder)) {
              const newName = `${entry.name}-${org}`;
              destFolder = path.join(config.syncFolder, 'reports', newName);
              renamed.push(`reports/${entry.name} → reports/${newName}`);
              if (fs.existsSync(destFolder)) {
                skipped.push(`reports/${newName} (already exists)`);
                continue;
              }
            }
            try {
              fs.mkdirSync(destFolder, { recursive: true });
              if (parsed.content.template_md) {
                const ext = templateExtension(parsed.meta.type);
                fs.writeFileSync(path.join(destFolder, `template${ext}`), parsed.content.template_md, 'utf-8');
              }
              if (parsed.content.template_css) {
                fs.writeFileSync(path.join(destFolder, 'style.css'), parsed.content.template_css, 'utf-8');
              }
              if (parsed.content.template_variables) {
                fs.writeFileSync(path.join(destFolder, 'variables.yaml'), parsed.content.template_variables, 'utf-8');
              }
              fs.writeFileSync(path.join(destFolder, 'meta.json'), JSON.stringify(parsed.meta, null, 2), 'utf-8');
              imported.push(`reports/${path.basename(destFolder)}`);
            } catch (e: unknown) {
              errors.push(`reports/${entry.name}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }

        vscode.window.showInformationMessage(
          `TRMM: Imported ${imported.filter(i => !i.startsWith('reports/')).length} scripts`
          + `${imported.some(i => i.startsWith('reports/')) ? ` and ${imported.filter(i => i.startsWith('reports/')).length} reports` : ''}`
          + `${renamed.length ? ` (${renamed.length} renamed)` : ''}`
        );

        outputChannel.appendLine(`\n📊 Import complete:`);
        outputChannel.appendLine(`   ✅ Imported: ${imported.length} (${imported.filter(i => i.startsWith('reports/')).length} reports, ${imported.filter(i => !i.startsWith('reports/')).length} scripts)`);
        if (renamed.length > 0) outputChannel.appendLine(`   🔄 Renamed (collision): ${renamed.length}`);
        if (skipped.length > 0) outputChannel.appendLine(`   ⏭️ Skipped: ${skipped.length}`);
        if (errors.length > 0) outputChannel.appendLine(`   ❌ Errors: ${errors.length}`);

      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`Import failed: ${msg}`);
        outputChannel.appendLine(`   ❌ ${msg}`);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    })
  );
}
