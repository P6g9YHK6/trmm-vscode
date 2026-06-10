import { describe, it, expect } from 'vitest';
import {
  parseMetadata,
  parseBlockCommentMetadata,
  buildMetadataBlock,
  buildFileContent,
  findMetadataBlockRange,
  getMetadataValue,
  setMetadataValue,
  getCommentPrefix,
  ScriptMetadata,
} from '../sync/metadata';

function makeMeta(overrides: Partial<ScriptMetadata> = {}): ScriptMetadata {
  return {
    name: 'test',
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
    code_hash: '',
    ids: {},
    ...overrides,
  };
}

const PS_CONTENT = `Write-Host "hello"
# --- TRMM METADATA BEGIN ---
# name: Test Script
# description: A test
# shell: powershell
# category: Maintenance
# supported_platforms: ["windows"]
# args: ["-ComputerName", "-Verbose"]
# env_vars: ["MY_VAR"]
# default_timeout: 120
# run_as_user: true
# syntax: powershell
# favorite: true
# hidden: false
# code_hash: abc123
# ids: a1b2c3d4=42 e5f6a7b8=99
# --- TRMM METADATA END ---`;

const PS_CONTENT_NO_META = `Write-Host "hello"
Write-Host "world"`;

describe('getCommentPrefix', () => {
  it('returns # for powershell', () => expect(getCommentPrefix('powershell')).toBe('# '));
  it('returns # for python', () => expect(getCommentPrefix('python')).toBe('# '));
  it('returns REM for cmd', () => expect(getCommentPrefix('cmd')).toBe('REM '));
  it('returns # for shell', () => expect(getCommentPrefix('shell')).toBe('# '));
  it('returns # for nushell', () => expect(getCommentPrefix('nushell')).toBe('# '));
  it('returns // for deno', () => expect(getCommentPrefix('deno')).toBe('// '));
  it('returns # for unknown shell', () => expect(getCommentPrefix('unknown')).toBe('# '));
});

describe('parseMetadata', () => {
  it('parses powershell metadata correctly', () => {
    const result = parseMetadata(PS_CONTENT, 'powershell');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('Write-Host "hello"');
    expect(result!.metadata.name).toBe('Test Script');
    expect(result!.metadata.description).toBe('A test');
    expect(result!.metadata.shell).toBe('powershell');
    expect(result!.metadata.category).toBe('Maintenance');
    expect(result!.metadata.supported_platforms).toEqual(['windows']);
    expect(result!.metadata.args).toEqual(['-ComputerName', '-Verbose']);
    expect(result!.metadata.env_vars).toEqual(['MY_VAR']);
    expect(result!.metadata.default_timeout).toBe(120);
    expect(result!.metadata.run_as_user).toBe(true);
    expect(result!.metadata.syntax).toBe('powershell');
    expect(result!.metadata.favorite).toBe(true);
    expect(result!.metadata.hidden).toBe(false);
    expect(result!.metadata.code_hash).toBe('abc123');
    expect(result!.metadata.ids).toEqual({ a1b2c3d4: 42, e5f6a7b8: 99 });
  });

  it('parses python metadata', () => {
    const content = `print("hello")
# --- TRMM METADATA BEGIN ---
# name: Py Script
# shell: python
# --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'python');
    expect(result).not.toBeNull();
    expect(result!.metadata.name).toBe('Py Script');
    expect(result!.metadata.shell).toBe('python');
  });

  it('parses batch metadata with REM prefix', () => {
    const content = `@echo off
REM --- TRMM METADATA BEGIN ---
REM name: Batch Script
REM shell: cmd
REM --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'cmd');
    expect(result).not.toBeNull();
    expect(result!.metadata.name).toBe('Batch Script');
    expect(result!.metadata.shell).toBe('cmd');
  });

  it('parses deno metadata with // prefix', () => {
    const content = `console.log("hello");
// --- TRMM METADATA BEGIN ---
// name: Deno Script
// shell: deno
// --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'deno');
    expect(result).not.toBeNull();
    expect(result!.metadata.name).toBe('Deno Script');
    expect(result!.metadata.shell).toBe('deno');
  });

  it('returns null when no begin marker', () => {
    const result = parseMetadata(PS_CONTENT_NO_META, 'powershell');
    expect(result).toBeNull();
  });

  it('returns null when no end marker', () => {
    const content = `Write-Host "hello"\n# --- TRMM METADATA BEGIN ---\n# name: Test`;
    const result = parseMetadata(content, 'powershell');
    expect(result).toBeNull();
  });

  it('returns code without trailing whitespace', () => {
    const content = `Write-Host "hello"\n\n\n# --- TRMM METADATA BEGIN ---\n# name: X\n# --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'powershell');
    expect(result!.code).toBe('Write-Host "hello"');
  });

  it('handles empty metadata block', () => {
    const content = `# --- TRMM METADATA BEGIN ---\n# --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'powershell');
    expect(result).not.toBeNull();
    expect(result!.metadata.name).toBe('');
  });

  it('handles multi-line description', () => {
    const content = `# --- TRMM METADATA BEGIN ---
# name: Multi
# description: Line one
# line two
# line three
# shell: powershell
# --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'powershell');
    expect(result!.metadata.description).toBe('Line one\nline two\nline three');
  });

  it('handles command/script type as shell alias', () => {
    const content = `# --- TRMM METADATA BEGIN ---\n# name: T\n# type: python\n# --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'python');
    expect(result!.metadata.shell).toBe('python');
  });

  it('parses platforms alias', () => {
    const content = `# --- TRMM METADATA BEGIN ---\n# name: T\n# platforms: ["linux"]\n# --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'shell');
    expect(result!.metadata.supported_platforms).toEqual(['linux']);
  });

  it('parses arguments alias', () => {
    const content = `# --- TRMM METADATA BEGIN ---\n# name: T\n# arguments: ["-a"]\n# --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'powershell');
    expect(result!.metadata.args).toEqual(['-a']);
  });

  it('parses "env vars" alias', () => {
    const content = `# --- TRMM METADATA BEGIN ---\n# name: T\n# env vars: ["FOO"]\n# --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'powershell');
    expect(result!.metadata.env_vars).toEqual(['FOO']);
  });

  it('parses "environment variables" alias', () => {
    const content = `# --- TRMM METADATA BEGIN ---\n# name: T\n# environment variables: ["BAR"]\n# --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'powershell');
    expect(result!.metadata.env_vars).toEqual(['BAR']);
  });

  it('parses timeout alias', () => {
    const content = `# --- TRMM METADATA BEGIN ---\n# name: T\n# timeout: 300\n# --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'powershell');
    expect(result!.metadata.default_timeout).toBe(300);
  });

  it('parses "run as user" alias', () => {
    const content = `# --- TRMM METADATA BEGIN ---\n# name: T\n# run as user: true\n# --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'powershell');
    expect(result!.metadata.run_as_user).toBe(true);
  });

  it('treats run_as_user "1" as true', () => {
    const content = `# --- TRMM METADATA BEGIN ---\n# name: T\n# run_as_user: 1\n# --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'powershell');
    expect(result!.metadata.run_as_user).toBe(true);
  });
});

describe('parseBlockCommentMetadata', () => {
  it('parses PowerShell block comment <# ... #>', () => {
    const content = `Write-Host "hi"
<#
===== TRMM SCRIPTS MARKER =====
name: Block PS
description: Block test
shell: powershell
category: Tools
supported_platforms: ["windows", "linux"]
args: ["-Force"]
env_vars: ["PATH"]
default_timeout: 60
run_as_user: false
syntax: powershell
favorite: true
hidden: false
code_hash: def456
ids: x1y2z3=7
===== END TRMM SCRIPTS MARKER =====
#>
Write-Host "bye"`;
    const result = parseBlockCommentMetadata(content);
    expect(result).not.toBeNull();
    expect(result!.code).toBe('Write-Host "hi"\nWrite-Host "bye"');
    expect(result!.metadata.name).toBe('Block PS');
    expect(result!.metadata.shell).toBe('powershell');
    expect(result!.metadata.category).toBe('Tools');
    expect(result!.metadata.supported_platforms).toEqual(['windows', 'linux']);
  });

  it('parses Python block comment """..."""', () => {
    const content = `x = 1
"""
===== TRMM SCRIPTS MARKER =====
name: Py Block
shell: python
===== END TRMM SCRIPTS MARKER =====
"""
y = 2`;
    const result = parseBlockCommentMetadata(content);
    expect(result).not.toBeNull();
    expect(result!.metadata.name).toBe('Py Block');
  });

  it('parses Deno block comment /*...*/', () => {
    const content = `const x = 1;
/*
===== TRMM SCRIPTS MARKER =====
name: Deno Block
shell: deno
===== END TRMM SCRIPTS MARKER =====
*/
const y = 2;`;
    const result = parseBlockCommentMetadata(content);
    expect(result).not.toBeNull();
    expect(result!.metadata.name).toBe('Deno Block');
  });

  it('returns null when no block marker', () => {
    const content = `Write-Host "hi"`;
    expect(parseBlockCommentMetadata(content)).toBeNull();
  });

  it('returns null when block has no name', () => {
    const content = `<#
===== TRMM SCRIPTS MARKER =====
shell: powershell
===== END TRMM SCRIPTS MARKER =====
#>`;
    expect(parseBlockCommentMetadata(content)).toBeNull();
  });
});

describe('buildMetadataBlock', () => {
  it('builds a correct metadata block for powershell', () => {
    const meta = makeMeta({ name: 'Test', args: ['-a'], code_hash: 'h1', ids: { a1: 42 } });
    const block = buildMetadataBlock(meta);
    expect(block).toContain('# --- TRMM METADATA BEGIN ---');
    expect(block).toContain('# --- TRMM METADATA END ---');
    expect(block).toContain('# name: Test');
    expect(block).toContain('# args: ["-a"]');
    expect(block).toContain('# code_hash: h1');
    expect(block).toContain('# ids: a1=42');
  });

  it('builds block for cmd with REM prefix', () => {
    const meta = makeMeta({ name: 'BAT', shell: 'cmd' });
    const block = buildMetadataBlock(meta);
    expect(block).toContain('REM --- TRMM METADATA BEGIN ---');
    expect(block).toContain('REM name: BAT');
    expect(block).toContain('REM --- TRMM METADATA END ---');
  });

  it('builds block for deno with // prefix', () => {
    const meta = makeMeta({ name: 'TS', shell: 'deno' });
    const block = buildMetadataBlock(meta);
    expect(block).toContain('// --- TRMM METADATA BEGIN ---');
    expect(block).toContain('// name: TS');
  });

  it('handles multi-line description', () => {
    const meta = makeMeta({ name: 'M', description: 'Line 1\nLine 2\nLine 3' });
    const block = buildMetadataBlock(meta);
    expect(block).toContain('# description: Line 1');
    expect(block).toContain('Line 2');
    expect(block).toContain('Line 3');
  });

  it('handles empty ids', () => {
    const meta = makeMeta({ name: 'NoIds', ids: {} });
    const block = buildMetadataBlock(meta);
    expect(block).toContain('ids:');
  });
});

describe('buildFileContent', () => {
  it('combines code and metadata block with blank line separator', () => {
    const meta = makeMeta({ name: 'Full' });
    const result = buildFileContent('echo hi', meta);
    expect(result).toContain('echo hi');
    expect(result).toContain('# --- TRMM METADATA BEGIN ---');
    expect(result).toMatch(/^echo hi\n\n# --- TRMM METADATA BEGIN/);
  });
});

describe('findMetadataBlockRange', () => {
  it('finds the correct line numbers', () => {
    const content = `line1
line2
# --- TRMM METADATA BEGIN ---
# name: Test
# --- TRMM METADATA END ---
line5`;
    const range = findMetadataBlockRange(content, 'powershell');
    expect(range).not.toBeNull();
    expect(range!.beginLine).toBe(2);
    expect(range!.endLine).toBe(4);
  });

  it('returns null when no markers', () => {
    expect(findMetadataBlockRange('no markers here', 'powershell')).toBeNull();
  });

  it('returns null when only begin marker', () => {
    const content = `# --- TRMM METADATA BEGIN ---\n# name: Test`;
    expect(findMetadataBlockRange(content, 'powershell')).toBeNull();
  });
});

describe('getMetadataValue', () => {
  const meta = makeMeta({
    name: 'N', description: 'D', shell: 'python', category: 'C',
    supported_platforms: ['linux'], args: ['-v'], env_vars: ['X'],
    default_timeout: 45, run_as_user: true, syntax: 'python',
    favorite: true, hidden: true,
  });

  it('returns name', () => expect(getMetadataValue(meta, 'name')).toBe('N'));
  it('returns description', () => expect(getMetadataValue(meta, 'description')).toBe('D'));
  it('returns shell', () => expect(getMetadataValue(meta, 'shell')).toBe('python'));
  it('returns category', () => expect(getMetadataValue(meta, 'category')).toBe('C'));
  it('returns supported_platforms as JSON', () => expect(getMetadataValue(meta, 'supported_platforms')).toBe('["linux"]'));
  it('returns args as JSON', () => expect(getMetadataValue(meta, 'args')).toBe('["-v"]'));
  it('returns env_vars as JSON', () => expect(getMetadataValue(meta, 'env_vars')).toBe('["X"]'));
  it('returns default_timeout as string', () => expect(getMetadataValue(meta, 'default_timeout')).toBe('45'));
  it('returns run_as_user as string', () => expect(getMetadataValue(meta, 'run_as_user')).toBe('true'));
  it('returns syntax', () => expect(getMetadataValue(meta, 'syntax')).toBe('python'));
  it('returns favorite as string', () => expect(getMetadataValue(meta, 'favorite')).toBe('true'));
  it('returns hidden as string', () => expect(getMetadataValue(meta, 'hidden')).toBe('true'));
  it('returns empty string for unknown key', () => expect(getMetadataValue(meta, 'unknown')).toBe(''));
});

describe('setMetadataValue', () => {
  it('sets name', () => {
    const m = makeMeta();
    setMetadataValue(m, 'name', 'New');
    expect(m.name).toBe('New');
  });

  it('sets description', () => {
    const m = makeMeta();
    setMetadataValue(m, 'description', 'Desc');
    expect(m.description).toBe('Desc');
  });

  it('sets shell', () => {
    const m = makeMeta();
    setMetadataValue(m, 'shell', 'python');
    expect(m.shell).toBe('python');
  });

  it('sets supported_platforms from JSON string', () => {
    const m = makeMeta();
    setMetadataValue(m, 'supported_platforms', '["linux","mac"]');
    expect(m.supported_platforms).toEqual(['linux', 'mac']);
  });

  it('sets args from space-separated string', () => {
    const m = makeMeta();
    setMetadataValue(m, 'args', '-a -b');
    expect(m.args).toEqual(['-a', '-b']);
  });

  it('sets default_timeout', () => {
    const m = makeMeta();
    setMetadataValue(m, 'default_timeout', '300');
    expect(m.default_timeout).toBe(300);
  });

  it('sets run_as_user from "true"', () => {
    const m = makeMeta();
    setMetadataValue(m, 'run_as_user', 'true');
    expect(m.run_as_user).toBe(true);
  });

  it('sets run_as_user from "false"', () => {
    const m = makeMeta();
    setMetadataValue(m, 'run_as_user', 'false');
    expect(m.run_as_user).toBe(false);
  });

  it('sets favorite', () => {
    const m = makeMeta();
    setMetadataValue(m, 'favorite', 'true');
    expect(m.favorite).toBe(true);
  });

  it('sets hidden', () => {
    const m = makeMeta();
    setMetadataValue(m, 'hidden', 'true');
    expect(m.hidden).toBe(true);
  });

  it('ignores unknown key', () => {
    const m = makeMeta();
    setMetadataValue(m, 'nonexistent', 'val');
    expect(m.name).toBe('test');
  });
});

describe('parseIds', () => {
  it('parses hash=id pairs', () => {
    const content = `Write-Host "hi"
# --- TRMM METADATA BEGIN ---
# name: T
# ids: a1b2c3d4=42 e5f6a7b8=99
# --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'powershell');
    expect(result!.metadata.ids).toEqual({ a1b2c3d4: 42, e5f6a7b8: 99 });
  });

  it('parses old url=id format and converts to hash', () => {
    const content = `# --- TRMM METADATA BEGIN ---
# name: T
# ids: https://rmm.example.com=42
# --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'powershell');
    expect(Object.keys(result!.metadata.ids)).toHaveLength(1);
    const hash = Object.keys(result!.metadata.ids)[0];
    expect(hash).toHaveLength(8);
    expect(hash).toMatch(/^[a-f0-9]{8}$/);
    expect(result!.metadata.ids[hash]).toBe(42);
  });
});

describe('safeJsonArray edge cases', () => {
  it('handles empty array string', () => {
    const content = `# --- TRMM METADATA BEGIN ---\n# name: T\n# args: []\n# --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'powershell');
    expect(result!.metadata.args).toEqual([]);
  });

  it('handles invalid JSON array gracefully', () => {
    const content = `# --- TRMM METADATA BEGIN ---\n# name: T\n# supported_platforms: [invalid\n# --- TRMM METADATA END ---`;
    const result = parseMetadata(content, 'powershell');
    expect(result!.metadata.supported_platforms).toEqual([]);
  });
});

describe('roundtrip', () => {
  it('parse -> build -> parse gives same result', () => {
    const meta = makeMeta({
      name: 'Roundtrip',
      description: 'Test roundtrip',
      shell: 'powershell',
      category: 'Tools',
      supported_platforms: ['windows'],
      args: ['-a', '-b'],
      env_vars: ['X'],
      default_timeout: 60,
      run_as_user: true,
      syntax: 'powershell',
      favorite: true,
      hidden: false,
      code_hash: 'hash123',
      ids: { a1b2c3d4: 42 },
    });
    const content = buildFileContent('Write-Host "hello"', meta);
    const parsed = parseMetadata(content, 'powershell');
    expect(parsed).not.toBeNull();
    expect(parsed!.metadata.name).toBe('Roundtrip');
    expect(parsed!.metadata.description).toBe('Test roundtrip');
    expect(parsed!.metadata.shell).toBe('powershell');
    expect(parsed!.metadata.category).toBe('Tools');
    expect(parsed!.metadata.supported_platforms).toEqual(['windows']);
    expect(parsed!.metadata.args).toEqual(['-a', '-b']);
    expect(parsed!.metadata.env_vars).toEqual(['X']);
    expect(parsed!.metadata.default_timeout).toBe(60);
    expect(parsed!.metadata.run_as_user).toBe(true);
    expect(parsed!.metadata.code_hash).toBe('hash123');
    expect(parsed!.metadata.ids).toEqual({ a1b2c3d4: 42 });
    expect(parsed!.code).toBe('Write-Host "hello"');
  });
});
