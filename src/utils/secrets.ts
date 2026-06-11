import * as vscode from 'vscode';

export const TRMM_API_KEY_SECRET = 'trmm.apiKey';

export async function getApiKey(context: vscode.ExtensionContext): Promise<string> {
  return (await context.secrets.get(TRMM_API_KEY_SECRET)) || '';
}

export async function setApiKey(context: vscode.ExtensionContext, value: string): Promise<void> {
  await context.secrets.store(TRMM_API_KEY_SECRET, value);
}

export async function deleteApiKey(context: vscode.ExtensionContext): Promise<void> {
  await context.secrets.delete(TRMM_API_KEY_SECRET);
}

export async function hasApiKey(context: vscode.ExtensionContext): Promise<boolean> {
  return !!(await getApiKey(context));
}

export async function migrateLegacyApiKey(context: vscode.ExtensionContext): Promise<boolean> {
  const cfg = vscode.workspace.getConfiguration('trmm');
  const legacy = cfg.get<string>('apiKey', '') || '';
  const existing = await getApiKey(context);

  if (!existing && legacy) {
    await setApiKey(context, legacy);
    await cfg.update('apiKey', '', vscode.ConfigurationTarget.Global);
    await cfg.update('apiKey', '', vscode.ConfigurationTarget.Workspace);
    await cfg.update('apiKey', '', vscode.ConfigurationTarget.WorkspaceFolder);
    return true;
  }

  return false;
}
