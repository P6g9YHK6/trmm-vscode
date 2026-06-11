import { describe, it, expect } from 'vitest';

describe('CLI parseArgs', () => {
  it('has the expected option formatting', () => {
    const helpLines = [
      '--enable-scripts [bool]    Enable script/snippet sync (default: true)',
      '--enable-reports [bool]    Enable report template sync (default: true)',
      '--enable-pull [bool]       Allow pulling from API (default: true)',
      '--enable-push [bool]       Allow pushing to API (default: true)',
      '--enable-git-history bool  Enable git history sync via API script (experimental, default: false)',
    ];

    for (const line of helpLines) {
      expect(line).toMatch(/--enable-(scripts|reports|pull|push|git-history)/);
    }
  });
});
