import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('test coverage', () => {
  const srcDir = path.resolve(__dirname, '..');
  const testDir = __dirname;

  const excludeDirs = new Set(['__tests__', 'node_modules']);
  const excludeFiles = new Set([
    'extension.ts',
    'logger.ts',
    'cli.ts',
    'ScriptEditorProvider.ts',
    'scriptEditorWebview.ts',
  ]);

  function collectFiles(dir: string, prefix: string = ''): string[] {
    const files: string[] = [];
    for (const name of fs.readdirSync(dir)) {
      if (excludeDirs.has(name)) continue;
      if (name.startsWith('.')) continue;
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (fs.statSync(full).isDirectory()) {
        files.push(...collectFiles(full, rel));
      } else if (name.endsWith('.ts') && !excludeFiles.has(name)) {
        files.push(rel);
      }
    }
    return files;
  }

  const sourceFiles = collectFiles(srcDir);

  for (const file of sourceFiles) {
    const testName = file.split('/').pop()!.replace(/\.ts$/, '.test.ts');
    const testPath = path.join(testDir, testName);

    it(`has a test for ${file}`, () => {
      expect(fs.existsSync(testPath)).toBe(true);
    });
  }
});
