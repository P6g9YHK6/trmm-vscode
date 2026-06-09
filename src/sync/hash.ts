import * as crypto from 'crypto';

export function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export function hashUrl(url: string): string {
  return sha256(url).slice(0, 8);
}
