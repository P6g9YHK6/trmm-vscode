import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  getExtension,
  inferShell,
  isScriptFile,
  sanitizeName,
  buildScriptPath,
  buildSnippetPath,
} from '../utils/pathBuilder';

describe('getExtension', () => {
  it('returns .ps1 for powershell', () => expect(getExtension('powershell')).toBe('.ps1'));
  it('returns .py for python', () => expect(getExtension('python')).toBe('.py'));
  it('returns .bat for cmd', () => expect(getExtension('cmd')).toBe('.bat'));
  it('returns .sh for shell', () => expect(getExtension('shell')).toBe('.sh'));
  it('returns .nu for nushell', () => expect(getExtension('nushell')).toBe('.nu'));
  it('returns .ts for deno', () => expect(getExtension('deno')).toBe('.ts'));
  it('returns .txt for unknown shell', () => expect(getExtension('unknown')).toBe('.txt'));
});

describe('inferShell', () => {
  it('.ps1 -> powershell', () => expect(inferShell('script.ps1')).toBe('powershell'));
  it('.psm1 -> powershell', () => expect(inferShell('mod.psm1')).toBe('powershell'));
  it('.psd1 -> powershell', () => expect(inferShell('mod.psd1')).toBe('powershell'));
  it('.py -> python', () => expect(inferShell('script.py')).toBe('python'));
  it('.bat -> cmd', () => expect(inferShell('script.bat')).toBe('cmd'));
  it('.cmd -> cmd', () => expect(inferShell('script.cmd')).toBe('cmd'));
  it('.sh -> shell', () => expect(inferShell('script.sh')).toBe('shell'));
  it('.bash -> shell', () => expect(inferShell('script.bash')).toBe('shell'));
  it('.zsh -> shell', () => expect(inferShell('script.zsh')).toBe('shell'));
  it('.nu -> nushell', () => expect(inferShell('script.nu')).toBe('nushell'));
  it('.ts -> deno', () => expect(inferShell('script.ts')).toBe('deno'));
  it('.js -> deno', () => expect(inferShell('script.js')).toBe('deno'));
  it('.jsx -> deno', () => expect(inferShell('script.jsx')).toBe('deno'));
  it('.tsx -> deno', () => expect(inferShell('script.tsx')).toBe('deno'));
  it('.mjs -> deno', () => expect(inferShell('script.mjs')).toBe('deno'));
  it('unknown -> powershell (default)', () => expect(inferShell('script.xyz')).toBe('powershell'));
  it('uppercase .PS1 -> powershell', () => expect(inferShell('script.PS1')).toBe('powershell'));
  it('no extension -> powershell (default)', () => expect(inferShell('script')).toBe('powershell'));
});

describe('isScriptFile', () => {
  it('returns true for .ps1', () => expect(isScriptFile('test.ps1')).toBe(true));
  it('returns true for .py', () => expect(isScriptFile('test.py')).toBe(true));
  it('returns true for .bat', () => expect(isScriptFile('test.bat')).toBe(true));
  it('returns true for .cmd', () => expect(isScriptFile('test.cmd')).toBe(true));
  it('returns true for .sh', () => expect(isScriptFile('test.sh')).toBe(true));
  it('returns true for .nu', () => expect(isScriptFile('test.nu')).toBe(true));
  it('returns true for .ts', () => expect(isScriptFile('test.ts')).toBe(true));
  it('returns true for .js', () => expect(isScriptFile('test.js')).toBe(true));
  it('returns false for .txt', () => expect(isScriptFile('test.txt')).toBe(false));
  it('returns false for .md', () => expect(isScriptFile('test.md')).toBe(false));
  it('returns false for no extension', () => expect(isScriptFile('test')).toBe(false));
});

describe('sanitizeName', () => {
  it('removes illegal characters', () => {
    expect(sanitizeName('a<b>c:d/e\\f|g?h*i')).toBe('abcdefghi');
  });
  it('trims whitespace', () => {
    expect(sanitizeName('  hello  ')).toBe('hello');
  });
  it('returns unnamed for null', () => expect(sanitizeName(null)).toBe('unnamed'));
  it('returns unnamed for undefined', () => expect(sanitizeName(undefined)).toBe('unnamed'));
  it('returns unnamed for empty string', () => expect(sanitizeName('')).toBe('unnamed'));
  it('returns unnamed for only illegal chars', () => expect(sanitizeName('<>:"|')).toBe('unnamed'));
  it('keeps normal names intact', () => expect(sanitizeName('HelloWorld')).toBe('HelloWorld'));
  it('handles names with spaces', () => expect(sanitizeName('My Script')).toBe('My Script'));
  it('handles names with hyphens', () => expect(sanitizeName('my-script')).toBe('my-script'));
  it('handles names with dots', () => expect(sanitizeName('script.v2')).toBe('script.v2'));
});

describe('buildScriptPath', () => {
  const syncFolder = '/base';

  it('builds path with category', () => {
    const result = buildScriptPath(syncFolder, 'My Script', 'Tools', 'powershell');
    expect(result).toBe(path.join('/base', 'scripts', 'Tools', 'My Script.ps1'));
  });

  it('builds path without category', () => {
    const result = buildScriptPath(syncFolder, 'test', '', 'python');
    expect(result).toBe(path.join('/base', 'scripts', 'test.py'));
  });

  it('sanitizes name and category', () => {
    const result = buildScriptPath(syncFolder, 'bad:name', 'bad<>cat', 'shell');
    expect(result).toBe(path.join('/base', 'scripts', 'badcat', 'badname.sh'));
  });
});

describe('buildSnippetPath', () => {
  it('builds .ps1 path under snippets', () => {
    const result = buildSnippetPath('/base', 'My Snippet');
    expect(result).toBe(path.join('/base', 'snippets', 'My Snippet.ps1'));
  });

  it('sanitizes snippet name', () => {
    const result = buildSnippetPath('/base', 'bad:snippet');
    expect(result).toBe(path.join('/base', 'snippets', 'badsnippet.ps1'));
  });
});
