import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getConfig } from '../utils/config';
import { ConflictResolver } from '../sync/syncEngine';

export function makeConflictResolver(): ConflictResolver | undefined {
  const config = getConfig();
  if (config.conflictStrategy !== 'ask') return undefined;

  return async (filePath: string, direction: 'pull' | 'push', localContent?: string, apiContent?: string) => {
    const relPath = path.basename(filePath);
    const dirLabel = path.dirname(path.relative(config.syncFolder, filePath));
    const label = dirLabel ? `${dirLabel}/${relPath}` : relPath;
    const directionLabel = direction === 'pull' ? 'API changed' : 'Local changed';

    if (localContent && apiContent) {
      const tmpDir = os.tmpdir();
      const tmpFile = path.join(tmpDir, `trmm-api-${relPath}`);
      try {
        fs.writeFileSync(tmpFile, apiContent, 'utf-8');
        await vscode.commands.executeCommand('vscode.diff',
          vscode.Uri.file(tmpFile),
          vscode.Uri.file(filePath),
          `${label}: API vs Local`
        );
      } catch { }
    }

    const choice = await vscode.window.showQuickPick(
      [
        { label: '$(check-all) API ALL', description: 'Use API version for all remaining conflicts', id: 'api-all' as const },
        { label: '$(check-all) LOCAL ALL', description: 'Keep local version for all remaining conflicts', id: 'local-all' as const },
        { label: '$(cloud-download) Use API version', description: 'Overwrite local file with API content', id: 'api' as const },
        { label: '$(edit) Use Local version', description: 'Keep local file, push to API', id: 'local' as const },
      ],
      {
        placeHolder: `${directionLabel}: ${label} - which version wins?`,
        canPickMany: false,
      }
    );
    return choice?.id || 'api';
  };
}
