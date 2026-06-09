import * as path from 'path';

const SHELL_EXTENSIONS: Record<string, string> = {
  powershell: '.ps1',
  python: '.py',
  cmd: '.bat',
  shell: '.sh',
  nushell: '.nu',
  deno: '.ts',
};

const EXT_TO_SHELL: Record<string, string> = {
  '.ps1': 'powershell',
  '.psm1': 'powershell',
  '.psd1': 'powershell',
  '.py': 'python',
  '.bat': 'cmd',
  '.cmd': 'cmd',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.nu': 'nushell',
  '.ts': 'deno',
  '.js': 'deno',
  '.jsx': 'deno',
  '.tsx': 'deno',
  '.mjs': 'deno',
};

export function getExtension(shell: string): string {
  return SHELL_EXTENSIONS[shell] || '.txt';
}

export function inferShell(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return EXT_TO_SHELL[ext] || 'powershell';
}

export function isScriptFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext in EXT_TO_SHELL;
}

export function sanitizeName(name: string | null | undefined): string {
  if (!name) return 'unnamed';
  return name.replace(/[<>:"/\\|?*]/g, '').trim() || 'unnamed';
}

export function buildScriptPath(
  syncFolder: string,
  name: string,
  category: string,
  shell: string
): string {
  const sanitized = sanitizeName(name);
  const ext = getExtension(shell);
  const cat = category ? sanitizeName(category) : '';
  if (cat) {
    return path.join(syncFolder, 'scripts', cat, `${sanitized}${ext}`);
  }
  return path.join(syncFolder, 'scripts', `${sanitized}${ext}`);
}

export function buildSnippetPath(
  syncFolder: string,
  name: string
): string {
  const sanitized = sanitizeName(name);
  return path.join(syncFolder, 'snippets', `${sanitized}.ps1`);
}
