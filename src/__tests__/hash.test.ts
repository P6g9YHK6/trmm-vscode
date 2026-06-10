import { describe, it, expect } from 'vitest';
import { sha256, hashUrl } from '../sync/hash';

describe('sha256', () => {
  it('returns a 64-char hex string for empty input', () => {
    const result = sha256('');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns consistent results for the same input', () => {
    expect(sha256('hello')).toBe(sha256('hello'));
  });

  it('returns different results for different inputs', () => {
    expect(sha256('hello')).not.toBe(sha256('world'));
  });

  it('handles multiline content', () => {
    const result = sha256('line1\nline2\nline3');
    expect(result).toHaveLength(64);
  });

  it('includes null bytes in hash', () => {
    const withNull = sha256('a\0b');
    const withoutNull = sha256('ab');
    expect(withNull).not.toBe(withoutNull);
  });
});

describe('hashUrl', () => {
  it('returns a consistent 8-char prefix for the same URL', () => {
    const url = 'https://rmm-api.exemple.com';
    expect(hashUrl(url)).toBe(hashUrl(url));
  });

  it('returns different hashes for different URLs', () => {
    const a = hashUrl('https://rmm-api.exemple.com/1');
    const b = hashUrl('https://rmm-api.exemple.com/2');
    expect(a).not.toBe(b);
  });

  it('returns an 8-char hex string', () => {
    const result = hashUrl('https://rmm-api.exemple.com');
    expect(result).toHaveLength(8);
    expect(result).toMatch(/^[a-f0-9]{8}$/);
  });
});
