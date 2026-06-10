import * as fs from 'fs';
import * as path from 'path';

const TMPDIR = path.join(__dirname, '..', '..', '.test-tmp');

export function getTmpDir(): string {
  if (!fs.existsSync(TMPDIR)) {
    fs.mkdirSync(TMPDIR, { recursive: true });
  }
  return TMPDIR;
}

export function cleanupTmpDir(): void {
  if (fs.existsSync(TMPDIR)) {
    fs.rmSync(TMPDIR, { recursive: true, force: true });
  }
}
