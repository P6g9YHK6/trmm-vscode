import * as vscode from 'vscode';

export interface TrmmConfig {
  apiUrl: string;
  syncFolder: string;
  autoPush: boolean;
  paranoidMode: boolean;
  gitSync: boolean;
  enableScripts: boolean;
  enableReports: boolean;
  enablePull: boolean;
  enablePush: boolean;
  conflictStrategy: 'ask' | 'local' | 'api';
  defaultShell: string;
  staleStrategy: 'skip' | 'overwrite';
  stripMetadata: boolean;
}

export function getConfig(): TrmmConfig {
  const cfg = vscode.workspace.getConfiguration('trmm');
  return {
    apiUrl: (cfg.get<string>('apiUrl', '') || '').replace(/\/+$/, ''),
    syncFolder: cfg.get<string>('syncFolder', ''),
    autoPush: cfg.get<boolean>('autoPush', false),
    paranoidMode: cfg.get<boolean>('paranoidMode', false),
    gitSync: cfg.get<boolean>('gitSync', true),
    enableScripts: cfg.get<boolean>('enableScripts', true),
    enableReports: cfg.get<boolean>('enableReports', true),
    enablePull: cfg.get<boolean>('enablePull', true),
    enablePush: cfg.get<boolean>('enablePush', true),
    conflictStrategy: cfg.get<'ask' | 'local' | 'api'>('conflictStrategy', 'ask'),
    defaultShell: cfg.get<string>('defaultShell', 'powershell'),
    staleStrategy: cfg.get<'skip' | 'overwrite'>('staleStrategy', 'skip'),
    stripMetadata: cfg.get<boolean>('stripMetadata', true),
  };
}

export function validateConfig(config: TrmmConfig, apiKey?: string): string | null {
  if (!config.apiUrl) return 'trmm.apiUrl is not configured';
  if (!apiKey) return 'TRMM API key is not configured';
  if (!config.syncFolder) return 'trmm.syncFolder is not configured';
  if (!config.apiUrl.startsWith('http://') && !config.apiUrl.startsWith('https://')) {
    return 'trmm.apiUrl must start with http:// or https://';
  }
  return null;
}
