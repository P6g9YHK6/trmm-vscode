import { sha256 } from './hash';

const COMMENT_PREFIX: Record<string, string> = {
  powershell: '# ',
  python: '# ',
  cmd: 'REM ',
  shell: '# ',
  nushell: '# ',
  deno: '// ',
};

const BEGIN_MARKER = '--- TRMM METADATA BEGIN ---';
const END_MARKER = '--- TRMM METADATA END ---';

const BLOCK_BEGIN_MARKER = '===== TRMM SCRIPTS MARKER =====';
const BLOCK_END_MARKER = '===== END TRMM SCRIPTS MARKER =====';

export interface ScriptMetadata {
  name: string;
  description: string;
  shell: string;
  category: string;
  supported_platforms: string[];
  args: string[];
  env_vars: string[];
  default_timeout: number;
  run_as_user: boolean;
  syntax: string;
  favorite: boolean;
  hidden: boolean;
  code_hash: string;
  meta_hash?: string;
  ids: Record<string, number>;
}

function defaultMetadata(): ScriptMetadata {
  return {
    name: '', description: '', shell: 'powershell', category: '',
    supported_platforms: [], args: [], env_vars: [],
    default_timeout: 90, run_as_user: false, syntax: '',
    favorite: false, hidden: false, code_hash: '', meta_hash: '', ids: {},
  };
}

export function getCommentPrefix(shell: string): string {
  return COMMENT_PREFIX[shell] || '# ';
}

function stripCommentPrefix(line: string): string {
  const t = line.trim();
  if (t.startsWith('# ')) return t.slice(2);
  if (t.startsWith('#')) return t.slice(1);
  if (t.startsWith('REM ')) return t.slice(4);
  if (t.startsWith(':: ')) return t.slice(3);
  if (t.startsWith('// ')) return t.slice(3);
  if (t.startsWith('//')) return t.slice(2);
  if (t.startsWith('/*')) return t.slice(2);
  if (t.startsWith('*/')) return t.slice(2);
  if (t.startsWith('*>')) return t.slice(2);
  return t;
}

const KNOWN_KEYS = new Set([
  'name', 'description', 'shell', 'type', 'category',
  'supported_platforms', 'platforms', 'args', 'arguments',
  'env_vars', 'env vars', 'environment variables',
  'default_timeout', 'timeout', 'run_as_user', 'run as user',
  'syntax', 'favorite', 'hidden', 'code_hash', 'meta_hash', 'ids',
]);

function parseKeyValueLines(lines: string[], target: ScriptMetadata): void {
  let lastKey = '';
  for (const line of lines) {
    const stripped = stripCommentPrefix(line);
    if (!stripped) { lastKey = ''; continue; }

    const colonIdx = stripped.indexOf(':');
    if (colonIdx === -1) {
      if (lastKey) appendValue(target, lastKey, stripped);
      continue;
    }

    const key = stripped.substring(0, colonIdx).trim().toLowerCase();
    const value = stripped.substring(colonIdx + 1).trim();

    if (lastKey && !KNOWN_KEYS.has(key)) {
      appendValue(target, lastKey, stripped);
      continue;
    }

    lastKey = key;

    switch (key) {
      case 'name':
        target.name = value.replace(/\\n/g, '\n'); break;
      case 'description':
        target.description = value.replace(/\\n/g, '\n'); break;
      case 'shell': case 'type':
        target.shell = value.toLowerCase(); break;
      case 'category':
        target.category = value.replace(/\\n/g, '\n'); break;
      case 'supported_platforms': case 'platforms':
        target.supported_platforms = safeJsonArray(value); break;
      case 'args': case 'arguments':
        target.args = safeJsonArray(value); break;
      case 'env_vars': case 'env vars': case 'environment variables':
        target.env_vars = safeJsonArray(value); break;
      case 'default_timeout': case 'timeout':
        target.default_timeout = parseInt(value) || 90; break;
      case 'run_as_user': case 'run as user':
        target.run_as_user = value === 'true' || value === '1'; break;
      case 'syntax':
        target.syntax = value.replace(/\\n/g, '\n'); break;
      case 'favorite':
        target.favorite = value === 'true'; break;
      case 'hidden':
        target.hidden = value === 'true'; break;
      case 'code_hash':
        target.code_hash = value; break;
      case 'meta_hash':
        target.meta_hash = value; break;
      case 'ids':
        target.ids = parseIds(value); break;
    }
  }
}

function appendValue(target: ScriptMetadata, key: string, value: string): void {
  switch (key) {
    case 'name': target.name += '\n' + value; break;
    case 'description': target.description += '\n' + value; break;
    case 'category': target.category += '\n' + value; break;
    case 'syntax': target.syntax += '\n' + value; break;
  }
}

function safeJsonArray(value: string): string[] {
  if (!value) return [];
  if (value.startsWith('[')) {
    try { return JSON.parse(value); } catch { return []; }
  }
  return value.split(/\s+/).filter(Boolean);
}

function parseIds(value: string): Record<string, number> {
  const ids: Record<string, number> = {};
  const pairs = value.match(/[a-f0-9]{8,}=\d+/g) || [];
  for (const pair of pairs) {
    const eqIdx = pair.lastIndexOf('=');
    const hash = pair.substring(0, eqIdx);
    const id = parseInt(pair.substring(eqIdx + 1));
    if (!isNaN(id)) ids[hash] = id;
  }
  if (Object.keys(ids).length === 0 && value.includes('=')) {
    const crypto = require('crypto');
    for (const pair of value.split(/\s+/)) {
      const eqIdx = pair.lastIndexOf('=');
      if (eqIdx === -1) continue;
      const url = pair.substring(0, eqIdx);
      const id = parseInt(pair.substring(eqIdx + 1));
      if (url && !isNaN(id)) {
        const hash = crypto.createHash('sha256').update(url, 'utf8').digest('hex').slice(0, 8);
        ids[hash] = id;
      }
    }
  }
  return ids;
}

export function parseMetadata(content: string, shell: string): { code: string; metadata: ScriptMetadata } | null {
  const prefix = COMMENT_PREFIX[shell] || '# ';
  const beginLine = `${prefix}${BEGIN_MARKER}`;
  const endLine = `${prefix}${END_MARKER}`;

  const beginIdx = content.indexOf(beginLine);
  if (beginIdx === -1) return null;

  const metaStart = beginIdx + beginLine.length;
  const endIdx = content.indexOf(endLine, metaStart);
  if (endIdx === -1) return null;

  const code = content.substring(0, beginIdx).trimEnd();
  const metaBlock = content.substring(metaStart, endIdx);

  const metadata = defaultMetadata();
  parseKeyValueLines(metaBlock.split('\n'), metadata);

  return { code, metadata };
}

export function parseBlockCommentMetadata(content: string): { code: string; metadata: ScriptMetadata } | null {
  const beginIdx = content.indexOf(BLOCK_BEGIN_MARKER);
  if (beginIdx === -1) return null;

  const endIdx = content.indexOf(BLOCK_END_MARKER, beginIdx);
  if (endIdx === -1) return null;

  const metaBlock = content.substring(beginIdx + BLOCK_BEGIN_MARKER.length, endIdx);
  const codeBefore = content.substring(0, beginIdx).trimEnd();
  const codeAfter = content.substring(endIdx + BLOCK_END_MARKER.length).trimStart();
  const delims = new Set(['<#', '#>', '"""', "'''", '/*', '*/']);
  const stripDelims = (s: string) => s.split('\n').filter(l => !delims.has(l.trim())).join('\n');
  const code = (stripDelims(codeBefore) + '\n' + stripDelims(codeAfter)).trim();

  const metadata = defaultMetadata();
  const lines = metaBlock.split('\n');

  const cleaned: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (['<#', '#>', '"""', "'''", '/*', '*/'].includes(t)) continue;
    cleaned.push(t);
  }

  parseKeyValueLines(cleaned, metadata);

  if (!metadata.name) return null;
  return { code, metadata };
}

export function buildMetadataBlock(metadata: ScriptMetadata): string {
  const prefix = getCommentPrefix(metadata.shell);
  const lines: string[] = [];

  function addField(key: string, raw: string) {
    lines.push(`${prefix}${key}: ${raw.replace(/\n/g, '\\n')}`);
  }

  lines.push(`${prefix}${BEGIN_MARKER}`);
  addField('name', metadata.name);
  addField('description', metadata.description);
  addField('shell', metadata.shell);
  addField('category', metadata.category);
  addField('supported_platforms', JSON.stringify(metadata.supported_platforms));
  addField('args', JSON.stringify(metadata.args));
  addField('env_vars', JSON.stringify(metadata.env_vars));
  addField('default_timeout', String(metadata.default_timeout));
  addField('run_as_user', String(metadata.run_as_user));
  addField('syntax', metadata.syntax);
  addField('favorite', String(metadata.favorite));
  addField('hidden', String(metadata.hidden));
  addField('code_hash', metadata.code_hash);
  addField('meta_hash', metadata.meta_hash || '');

  const idsStr = Object.entries(metadata.ids)
    .map(([hash, id]) => `${hash}=${id}`)
    .join(' ');
  addField('ids', idsStr);

  lines.push(`${prefix}${END_MARKER}`);

  return lines.join('\n');
}

export function buildFileContent(code: string, metadata: ScriptMetadata): string {
  const metaBlock = buildMetadataBlock(metadata);
  return `${code}\n\n${metaBlock}\n`;
}

export function buildSnippetFileContent(code: string, metadata: ScriptMetadata): string {
  const prefix = '# ';
  const lines: string[] = [];
  const addField = (key: string, raw: string) => {
    lines.push(`${prefix}${key}: ${raw.replace(/\n/g, '\\n')}`);
  };

  lines.push(`${prefix}${BEGIN_MARKER}`);
  addField('name', metadata.name);
  addField('description', metadata.description);
  addField('shell', metadata.shell);
  addField('code_hash', metadata.code_hash);
  addField('meta_hash', metadata.meta_hash || '');

  const idsStr = Object.entries(metadata.ids)
    .map(([hash, id]) => `${hash}=${id}`)
    .join(' ');
  addField('ids', idsStr);

  lines.push(`${prefix}${END_MARKER}`);

  return `${code}\n\n${lines.join('\n')}\n`;
}

export function getMetadataValue(metadata: ScriptMetadata, key: string): string {
  switch (key) {
    case 'name': return metadata.name;
    case 'description': return metadata.description;
    case 'shell': return metadata.shell;
    case 'category': return metadata.category;
    case 'supported_platforms': return JSON.stringify(metadata.supported_platforms);
    case 'args': return JSON.stringify(metadata.args);
    case 'env_vars': return JSON.stringify(metadata.env_vars);
    case 'default_timeout': return String(metadata.default_timeout);
    case 'run_as_user': return String(metadata.run_as_user);
    case 'syntax': return metadata.syntax;
    case 'favorite': return String(metadata.favorite);
    case 'hidden': return String(metadata.hidden);
    default: return '';
  }
}

export interface MetadataBlockRange {
  beginLine: number;
  endLine: number;
}

export function findMetadataBlockRange(content: string, shell: string): MetadataBlockRange | null {
  const prefix = COMMENT_PREFIX[shell] || '# ';
  const beginMarker = `${prefix}${BEGIN_MARKER}`;
  const endMarker = `${prefix}${END_MARKER}`;
  const lines = content.split('\n');

  let beginIdx = -1;
  let endIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === beginMarker) beginIdx = i;
    if (trimmed === endMarker && beginIdx !== -1) { endIdx = i; break; }
  }

  if (beginIdx === -1 || endIdx === -1) return null;
  return { beginLine: beginIdx, endLine: endIdx };
}

export function setMetadataValue(metadata: ScriptMetadata, key: string, value: string): void {
  switch (key) {
    case 'name': metadata.name = value; break;
    case 'description': metadata.description = value; break;
    case 'shell': metadata.shell = value; break;
    case 'category': metadata.category = value; break;
    case 'supported_platforms': metadata.supported_platforms = safeJsonArray(value); break;
    case 'args': metadata.args = safeJsonArray(value); break;
    case 'env_vars': metadata.env_vars = safeJsonArray(value); break;
    case 'default_timeout': metadata.default_timeout = parseInt(value) || 90; break;
    case 'run_as_user': metadata.run_as_user = value === 'true'; break;
    case 'syntax': metadata.syntax = value; break;
    case 'favorite': metadata.favorite = value === 'true'; break;
    case 'hidden': metadata.hidden = value === 'true'; break;
  }
}

const metaHashFields: (keyof ScriptMetadata)[] = [
  'name', 'description', 'shell', 'category',
  'supported_platforms', 'args', 'env_vars',
  'default_timeout', 'run_as_user', 'syntax',
  'favorite', 'hidden',
];

export function computeMetaHash(meta: ScriptMetadata): string {
  const obj: Record<string, unknown> = {};
  for (const k of metaHashFields) {
    obj[k] = meta[k];
  }
  return sha256(JSON.stringify(obj, Object.keys(obj).sort()));
}
