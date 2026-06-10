import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { Logger } from '../logger';

export function ensureGitRepo(syncFolder: string): void {
  if (fs.existsSync(path.join(syncFolder, '.git'))) return;

  execSync('git init', { cwd: syncFolder, stdio: 'pipe' });

  const gitignorePath = path.join(syncFolder, '.gitignore');
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
  if (!existing.includes('.trmm-manifest.json')) {
    fs.writeFileSync(gitignorePath, existing + '\n.trmm-manifest.json\n', 'utf-8');
  }

  execSync('git add .gitignore', { cwd: syncFolder, stdio: 'pipe' });
  try {
    execSync('git commit -m "initial sync folder"', { cwd: syncFolder, stdio: 'pipe' });
  } catch { /* ok if nothing to commit */ }
}

function formatFileList(syncFolder: string): string {
  try {
    const raw = execSync('git diff --cached --name-status', { cwd: syncFolder, encoding: 'utf-8', stdio: 'pipe' });
    return raw.trim();
  } catch {
    return '';
  }
}

export function commitSyncChanges(syncFolder: string, type: 'push' | 'pull', outputChannel: Logger): void {
  ensureGitRepo(syncFolder);

  execSync('git add scripts/ snippets/ reports/', { cwd: syncFolder, stdio: 'pipe' });

  const fileList = formatFileList(syncFolder);
  if (!fileList) {
    outputChannel.appendLine('  📋 No changes to commit');
    return;
  }

  const lineCount = fileList.split('\n').length;
  const prefix = type === 'push' ? 'push' : 'pull from API';

  const msg = `${prefix}: ${lineCount} file(s) changed\n\n${fileList}`;

  try {
    execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: syncFolder, stdio: 'pipe' });
    outputChannel.appendLine(`  📝 Git committed: ${prefix}, ${lineCount} file(s)`);
  } catch (e: unknown) {
    outputChannel.appendLine(`  ⚠️ Git commit failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
