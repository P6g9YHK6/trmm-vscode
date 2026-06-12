import { describe, it, expect, vi } from 'vitest';
vi.mock('vscode', () => ({}));
import { extractOrgFromUrl, generateName, getRelativeDir, validateRepoUrl } from '../commands/importFromGit';

describe('extractOrgFromUrl', () => {
  it('extracts org from https URL', () => {
    expect(extractOrgFromUrl('https://github.com/acme-sre/toolkit.git')).toBe('acme-sre');
  });

  it('extracts org from SSH URL', () => {
    expect(extractOrgFromUrl('git@github.com:my-org/repo.git')).toBe('my-org');
  });

  it('extracts org from URL without .git suffix', () => {
    expect(extractOrgFromUrl('https://gitlab.com/team-alpha/scripts')).toBe('team-alpha');
  });

  it('extracts org with nested path', () => {
    expect(extractOrgFromUrl('https://github.com/org/team/repo.git')).toBe('org/team');
  });

  it('extracts org from ssh:// URI', () => {
    expect(extractOrgFromUrl('ssh://git@github.com/org-name/repo.git')).toBe('org-name');
  });

  it('handles colon-separated SSH with nested path', () => {
    expect(extractOrgFromUrl('git@github.com:org/team/repo.git')).toBe('org/team');
  });

  it('does not return empty for orgless URL', () => {
    expect(extractOrgFromUrl('https://github.com')).not.toBe('');
  });
});

describe('generateName', () => {
  it('returns metadata name when parsed', () => {
    expect(generateName({ code: '', metadata: { name: 'MyScript' } as any }, '/path/to/file.ps1')).toBe('MyScript');
  });

  it('returns filename without extension when no parsed metadata', () => {
    expect(generateName(null, '/path/to/FileWithNoMeta.ps1')).toBe('FileWithNoMeta');
  });

  it('returns filename when metadata name is empty', () => {
    expect(generateName({ code: '', metadata: { name: '' } as any }, '/path/to/file.ps1')).toBe('file');
  });
});

describe('getRelativeDir', () => {
  const base = '/sync/scripts';

  it('returns empty string for files in base dir', () => {
    expect(getRelativeDir('/sync/scripts/test.ps1', base)).toBe('');
  });

  it('returns relative subdirectory', () => {
    expect(getRelativeDir('/sync/scripts/networking/ping.ps1', base)).toBe('networking');
  });

  it('returns nested subdirectories', () => {
    expect(getRelativeDir('/sync/scripts/linux/security/audit.sh', base)).toBe('linux/security');
  });
});

describe('validateRepoUrl', () => {
  it('accepts valid HTTPS URL', () => {
    expect(validateRepoUrl('https://github.com/acme/toolkit.git')).toBeNull();
  });

  it('accepts valid SSH URL', () => {
    expect(validateRepoUrl('git@github.com:acme/toolkit.git')).toBeNull();
  });

  it('accepts ssh:// URI', () => {
    expect(validateRepoUrl('ssh://git@github.com/acme/toolkit.git')).toBeNull();
  });

  it('rejects ext:: protocol URL', () => {
    expect(validateRepoUrl('ext::sh -c "command"')).not.toBeNull();
  });

  it('rejects file:// URL', () => {
    expect(validateRepoUrl('file:///etc/passwd')).not.toBeNull();
  });

  it('rejects URL with -- injection', () => {
    expect(validateRepoUrl('https://github.com/acme/repo.git --config')).not.toBeNull();
  });

  it('rejects URL with -c option', () => {
    expect(validateRepoUrl('https://github.com/acme/repo.git -c core.gitProxy=command')).not.toBeNull();
  });

  it('rejects empty URL', () => {
    expect(validateRepoUrl('')).not.toBeNull();
  });

  it('rejects URL without any scheme prefix', () => {
    expect(validateRepoUrl('github.com/acme/repo.git')).not.toBeNull();
  });
});
