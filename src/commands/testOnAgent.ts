import * as vscode from 'vscode';
import { getConfig, validateConfig, showConfigError } from '../utils/config';
import { TrmmApi, Agent } from '../api/trmmApi';
import { parseMetadata } from '../sync/metadata';
import { inferShell } from '../utils/pathBuilder';
import { toErrorMessage } from '../logger';

let agentCache: Agent[] = [];
let cachedApiUrl = '';

export function registerTestOnAgentCommand(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
  context.subscriptions.push(
    vscode.commands.registerCommand('trmm.testOnAgent', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Open a script file first');
        return;
      }

      const config = getConfig();
      const err = validateConfig(config);
      if (err) {
        await showConfigError(err);
        return;
      }

      const filePath = editor.document.uri.fsPath;
      const content = editor.document.getText();
      const shell = inferShell(filePath);
      const parsed = parseMetadata(content, shell);

      if (!parsed) {
        vscode.window.showWarningMessage('No TRMM metadata found in this file.');
        return;
      }

      if (agentCache.length === 0 || config.apiUrl !== cachedApiUrl) {
        cachedApiUrl = config.apiUrl;
        await refreshAgents(config.apiUrl, config.apiKey, outputChannel);
      }

      const agentPick = await vscode.window.showQuickPick(
        agentCache.map(a => ({
          label: a.hostname,
          description: a.plat || '',
          detail: a.agent_id,
          id: a.agent_id,
        })),
        { placeHolder: 'Select agent to test on', matchOnDetail: true }
      );

      if (!agentPick) return;

      if (!parsed.metadata.default_timeout || parsed.metadata.default_timeout < 5) {
        parsed.metadata.default_timeout = 90;
      }

      const testOutput = vscode.window.createOutputChannel('TRMM Test Result');
      testOutput.show(true);
      testOutput.appendLine(`🧪 Testing "${parsed.metadata.name}" on ${agentPick.label}...`);
      testOutput.appendLine(`Shell: ${parsed.metadata.shell}, Timeout: ${parsed.metadata.default_timeout}s`);
      testOutput.appendLine('');

      try {
        const api = new TrmmApi(config.apiUrl, config.apiKey);
        const result = await api.testOnAgent(agentPick.id, {
          code: parsed.code,
          timeout: parsed.metadata.default_timeout,
          args: parsed.metadata.args,
          shell: parsed.metadata.shell,
          run_as_user: parsed.metadata.run_as_user,
          env_vars: parsed.metadata.env_vars,
        });

        testOutput.appendLine(`✅ Return code: ${result.returncode}`);
        testOutput.appendLine(`⏱️ Execution time: ${result.execution_time}s`);
        testOutput.appendLine('');

        if (result.stdout) {
          testOutput.appendLine('─── STDOUT ───');
          testOutput.appendLine(result.stdout);
        }
        if (result.stderr) {
          testOutput.appendLine('─── STDERR ───');
          testOutput.appendLine(result.stderr);
        }

        if (result.returncode === 0) {
          testOutput.appendLine('\n✅ Script completed successfully');
        } else {
          testOutput.appendLine(`\n⚠️ Script exited with code ${result.returncode}`);
        }
      } catch (e: unknown) {
        testOutput.appendLine(`❌ Test failed: ${toErrorMessage(e)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('trmm.refreshAgents', async () => {
      const config = getConfig();
      const e = validateConfig(config);
      if (e) {
        await showConfigError(e);
        return;
      }
      await refreshAgents(config.apiUrl, config.apiKey, outputChannel);
      vscode.window.showInformationMessage(`TRMM: Refreshed ${agentCache.length} agents`);
    })
  );
}

async function refreshAgents(apiUrl: string, apiKey: string, outputChannel: vscode.OutputChannel) {
  try {
    const api = new TrmmApi(apiUrl, apiKey);
    agentCache = await api.fetchAgents();
    outputChannel.appendLine(`Agents cached: ${agentCache.length}`);
  } catch (e: unknown) {
    outputChannel.appendLine(`Failed to fetch agents: ${toErrorMessage(e)}`);
  }
}


