import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { Logger } from '../logger';

function git(args: string[], opts?: { cwd?: string; stdio?: string; encoding?: string }): string {
  return execFileSync('git', args, opts as any)?.toString() ?? '';
}

export function ensureGitRepo(syncFolder: string): void {
  if (fs.existsSync(path.join(syncFolder, '.git'))) return;

  git(['init'], { cwd: syncFolder, stdio: 'pipe' });

  const gitignorePath = path.join(syncFolder, '.gitignore');
  const existing = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, 'utf-8') : '';
  if (!existing.includes('.trmm-manifest.json')) {
    fs.writeFileSync(gitignorePath, existing + '\n.trmm-manifest.json\n', 'utf-8');
  }

  git(['add', '.gitignore'], { cwd: syncFolder, stdio: 'pipe' });
  try {
    git(['commit', '-m', 'initial sync folder'], { cwd: syncFolder, stdio: 'pipe' });
  } catch {
    // ok if nothing to commit
  }
}

function formatFileList(syncFolder: string): string {
  try {
    return git(['diff', '--cached', '--name-status'], { cwd: syncFolder, stdio: 'pipe', encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

export function commitSyncChanges(syncFolder: string, type: 'push' | 'pull', outputChannel: Logger): void {
  ensureGitRepo(syncFolder);

  const dirs = ['scripts', 'snippets', 'reports'].filter(d => fs.existsSync(path.join(syncFolder, d)));
  if (dirs.length > 0) {
    outputChannel.verbose(`git add ${dirs.map(d => d + '/').join(' ')}`);
    git(['add', ...dirs.map(d => d + '/')], { cwd: syncFolder, stdio: 'pipe' });
  }

  const fileList = formatFileList(syncFolder);
  if (!fileList) {
    outputChannel.verbose('  No changes to commit');
    return;
  }

  const lineCount = fileList.split('\n').length;
  const prefix = type === 'push' ? 'push' : 'pull from API';

  const msg = `${prefix}: ${lineCount} file(s) changed\n\n${fileList}`;

  try {
    outputChannel.verbose(`git commit -m "${prefix}: ${lineCount} file(s)"`);
    git(['commit', '-m', msg], { cwd: syncFolder, stdio: 'pipe' });
    outputChannel.appendLine(`  📝 Git committed: ${prefix}, ${lineCount} file(s)`);
  } catch (e: unknown) {
    outputChannel.appendLine(`  ⚠️ Git commit failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
