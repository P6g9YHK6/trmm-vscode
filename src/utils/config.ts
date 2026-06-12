import * as vscode from 'vscode';

let _secretApiKey: string | undefined;

export function setSecretApiKey(key: string | undefined) {
  _secretApiKey = key;
}

export function clearSecretApiKey(): void {
  _secretApiKey = undefined;
}

export interface TrmmConfig {
  apiUrl: string;
  apiKey: string;
  syncFolder: string;
  autoPush: boolean;
  paranoidMode: boolean;
  enableScripts: boolean;
  enableReports: boolean;
  enablePull: boolean;
  enablePush: boolean;
  enableGitHistory: boolean;
  conflictStrategy: 'ask' | 'local' | 'api';
  defaultShell: string;
  staleStrategy: 'skip' | 'overwrite';
  stripMetadata: boolean;
  verboseLogging: boolean;
}

export function getConfig(): TrmmConfig {
  const cfg = vscode.workspace.getConfiguration('trmm');
  return {
    apiUrl: (cfg.get<string>('apiUrl', '') || '').replace(/\/+$/, ''),
    apiKey: _secretApiKey ?? cfg.get<string>('apiKey', ''),
    syncFolder: cfg.get<string>('syncFolder', ''),
    autoPush: cfg.get<boolean>('autoPush', false),
    paranoidMode: cfg.get<boolean>('paranoidMode', false),
    enableScripts: cfg.get<boolean>('enableScripts', true),
    enableReports: cfg.get<boolean>('enableReports', true),
    enablePull: cfg.get<boolean>('enablePull', true),
    enablePush: cfg.get<boolean>('enablePush', true),
    enableGitHistory: cfg.get<boolean>('enableGitHistory', true),
    conflictStrategy: cfg.get<'ask' | 'local' | 'api'>('conflictStrategy', 'ask'),
    defaultShell: cfg.get<string>('defaultShell', 'powershell'),
    staleStrategy: cfg.get<'skip' | 'overwrite'>('staleStrategy', 'skip'),
    stripMetadata: cfg.get<boolean>('stripMetadata', true),
    verboseLogging: cfg.get<boolean>('verboseLogging', false),
  };
}

export function validateConfig(config: TrmmConfig): string | null {
  if (!config.apiUrl) return 'trmm.apiUrl is not configured';
  if (!config.apiKey) return 'trmm.apiKey is not configured';
  if (!config.syncFolder) return 'trmm.syncFolder is not configured';
  if (!config.apiUrl.startsWith('http://') && !config.apiUrl.startsWith('https://')) {
    return 'trmm.apiUrl must start with http:// or https://';
  }
  return null;
}

export async function showConfigError(err: string): Promise<void> {
  const settingMatch = err.match(/trmm\.(\w+)/);
  const filter = settingMatch ? `@ext:P6g9YHK6.trmm-vscode ${settingMatch[1]}` : '@ext:P6g9YHK6.trmm-vscode';
  await vscode.window.showErrorMessage(
    `TRMM: ${err} — [Open Settings](command:workbench.action.openSettings?${encodeURIComponent(JSON.stringify(filter))})`
  );
}
