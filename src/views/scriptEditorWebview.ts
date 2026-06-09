export function getWebviewHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
:root {
  --bg: var(--vscode-editor-background, #1e1e1e);
  --fg: var(--vscode-editor-foreground, #d4d4d4);
  --input-bg: var(--vscode-input-background, #3c3c3c);
  --input-fg: var(--vscode-input-foreground, #cccccc);
  --input-border: var(--vscode-input-border, #555);
  --border: var(--vscode-panel-border, #444);
  --dropdown-bg: var(--vscode-dropdown-background, #3c3c3c);
  --dropdown-border: var(--vscode-dropdown-border, #555);
  --btn-bg: var(--vscode-button-background, #0e639c);
  --btn-fg: var(--vscode-button-foreground, #ffffff);
  --btn-hover: var(--vscode-button-hoverBackground, #1177bb);
  --btn-secondary: var(--vscode-button-secondaryBackground, #3a3d41);
  --btn-secondary-hover: var(--vscode-button-secondaryHoverBackground, #45494e);
  --focus-border: var(--vscode-focusBorder, #007fd4);
  --badge-bg: var(--vscode-badge-background, #4d4d4d);
  --badge-fg: var(--vscode-badge-foreground, #ffffff);
  --error-fg: var(--vscode-errorForeground, #f48771);
  --scrollbar-bg: var(--vscode-scrollbarSlider-background, #424242);
  --scrollbar-hover: var(--vscode-scrollbarSlider-hoverBackground, #4f4f4f);
  --font-family: var(--vscode-font-family, -apple-system, sans-serif);
  --font-size: var(--vscode-font-size, 13px);
  --input-font-family: var(--vscode-editor-font-family, monospace);
}
body {
  font-family: var(--font-family);
  font-size: var(--font-size);
  color: var(--fg);
  background: var(--bg);
  overflow: hidden;
  height: 100vh;
  display: flex;
  flex-direction: column;
}
#no-script { display: flex; align-items: center; justify-content: center; height: 100%; padding: 16px; text-align: center; color: var(--error-fg); }
#no-config { display: none; align-items: center; justify-content: center; height: 100%; padding: 16px; text-align: center; color: var(--fg); }
#editor-panel { display: none; flex-direction: column; height: 100vh; }
#scroll-area { flex: 1; overflow-y: auto; padding: 8px; }
#scroll-area::-webkit-scrollbar { width: 6px; }
#scroll-area::-webkit-scrollbar-thumb { background: var(--scrollbar-bg); border-radius: 3px; }
#scroll-area::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-hover); }

.field-group { margin-bottom: 8px; }
.field-label { display: block; margin-bottom: 2px; font-size: 11px; text-transform: uppercase; opacity: 0.8; font-weight: 600; }
.field-label .required { color: var(--error-fg); }
input[type="text"], input[type="number"], textarea, select {
  width: 100%;
  padding: 4px 6px;
  background: var(--input-bg);
  color: var(--input-fg);
  border: 1px solid var(--input-border);
  border-radius: 2px;
  font-family: var(--font-family);
  font-size: var(--font-size);
  outline: none;
}
input:focus, textarea:focus, select:focus { border-color: var(--focus-border); }
textarea { resize: vertical; min-height: 28px; }
select { cursor: pointer; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath fill='%23ccc' d='M2 3l3 4 3-4'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 6px center; padding-right: 20px; }
input[type="checkbox"] { accent-color: var(--focus-border); cursor: pointer; }
.checkbox-group { display: flex; align-items: center; gap: 6px; cursor: pointer; margin-top: 4px; }
.checkbox-group label { cursor: pointer; font-size: var(--font-size); }

/* Multi-select */
.multi-select { position: relative; }
.multi-select-trigger {
  display: flex; flex-wrap: wrap; gap: 3px; align-items: center;
  min-height: 24px; padding: 2px 4px;
  background: var(--input-bg); color: var(--input-fg);
  border: 1px solid var(--input-border); border-radius: 2px; cursor: pointer;
}
.multi-select-trigger:focus { border-color: var(--focus-border); }
.multi-chip {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 1px 5px; font-size: 11px;
  background: var(--badge-bg); color: var(--badge-fg); border-radius: 2px;
}
.multi-chip-remove { cursor: pointer; opacity: 0.7; font-weight: bold; }
.multi-chip-remove:hover { opacity: 1; }
.multi-select-placeholder { opacity: 0.5; font-size: var(--font-size); }
.multi-select-dropdown {
  display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 10;
  max-height: 140px; overflow-y: auto;
  background: var(--dropdown-bg); border: 1px solid var(--dropdown-border);
  border-radius: 2px; margin-top: 2px;
}
.multi-select-dropdown.open { display: block; }
.multi-select-option {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 8px; cursor: pointer;
}
.multi-select-option:hover { background: rgba(255,255,255,0.08); }
.multi-select-option input[type="checkbox"] { margin: 0; }

/* Tag input */
.tag-input-wrap { border: 1px solid var(--input-border); border-radius: 2px; background: var(--input-bg); padding: 2px 4px; display: flex; flex-wrap: wrap; gap: 3px; align-items: center; cursor: text; }
.tag-input-wrap:focus-within { border-color: var(--focus-border); }
.tag { display: inline-flex; align-items: center; gap: 3px; padding: 1px 5px; font-size: 11px; background: var(--badge-bg); color: var(--badge-fg); border-radius: 2px; }
.tag-remove { cursor: pointer; opacity: 0.7; font-weight: bold; }
.tag-remove:hover { opacity: 1; }
.tag-input { flex: 1; min-width: 60px; border: none !important; background: none !important; padding: 2px 0 !important; outline: none; color: var(--input-fg); font-family: var(--font-family); font-size: var(--font-size); }

/* Bottom bar */
#bottom-bar {
  padding: 8px;
  border-top: 1px solid var(--border);
  background: var(--bg);
}
#agent-select-wrap { position: relative; margin-bottom: 6px; }
#agent-search {
  width: 100%; padding: 4px 6px;
  background: var(--input-bg); color: var(--input-fg);
  border: 1px solid var(--input-border); border-radius: 2px;
  font-family: var(--font-family); font-size: var(--font-size);
  outline: none;
}
#agent-search:focus { border-color: var(--focus-border); }
#agent-dropdown {
  display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 10;
  max-height: 160px; overflow-y: auto;
  background: var(--dropdown-bg); border: 1px solid var(--dropdown-border);
  border-radius: 2px; margin-top: 2px;
}
#agent-dropdown.open { display: block; }
.agent-option { padding: 4px 8px; cursor: pointer; font-size: var(--font-size); }
.agent-option:hover { background: rgba(255,255,255,0.08); }
.agent-option.selected { background: rgba(255,255,255,0.12); }
.agent-option .agent-plat { opacity: 0.6; font-size: 11px; }
#agent-loading { display: none; text-align: center; padding: 4px; opacity: 0.6; font-size: 11px; }
#agent-error { display: none; color: var(--error-fg); font-size: 11px; padding: 4px; text-align: center; }
#action-buttons { display: flex; gap: 4px; }
#action-buttons button {
  flex: 1; padding: 5px 8px;
  border: none; border-radius: 2px; cursor: pointer;
  font-family: var(--font-family); font-size: var(--font-size);
  text-align: center;
}
#btn-test-agent { background: var(--btn-bg); color: var(--btn-fg); }
#btn-test-agent:hover:not(:disabled) { background: var(--btn-hover); }
#btn-test-server { background: var(--btn-secondary); color: var(--btn-fg); }
#btn-test-server:hover:not(:disabled) { background: var(--btn-secondary-hover); }
#action-buttons button:disabled { opacity: 0.4; cursor: default; }

/* Test result */
#test-result {
  display: none; margin-top: 8px; padding: 8px;
  background: var(--input-bg); border: 1px solid var(--input-border);
  border-radius: 2px; font-family: var(--input-font-family);
  font-size: 11px; white-space: pre-wrap; word-break: break-all;
  max-height: 200px; overflow-y: auto;
}
#test-result .meta-line { opacity: 0.7; font-family: var(--font-family); }
</style>
</head>
<body>

<div id="no-script">Open a TRMM script file to edit metadata</div>
<div id="no-config">Configure <code>trmm.apiUrl</code> and <code>trmm.apiKey</code> in settings</div>

<div id="editor-panel">
  <div id="scroll-area">
    <div class="field-group">
      <label class="field-label">Name <span class="required">*</span></label>
      <input type="text" id="field-name" autocomplete="off">
    </div>

    <div class="field-group">
      <label class="field-label">Description</label>
      <textarea id="field-description" rows="2"></textarea>
    </div>

    <div class="field-group">
      <label class="field-label">Shell Type</label>
      <select id="field-shell">
        <option value="powershell">PowerShell</option>
        <option value="python">Python</option>
        <option value="cmd">Batch (CMD)</option>
        <option value="shell">Shell (Bash)</option>
        <option value="nushell">Nushell</option>
        <option value="deno">Deno (JS/TS)</option>
      </select>
    </div>

    <div class="field-group">
      <label class="field-label">Supported Platforms</label>
      <div class="multi-select" id="field-platforms">
        <div class="multi-select-trigger" tabindex="0" id="platforms-trigger">
          <span class="multi-select-placeholder" id="platforms-placeholder">All supported if blank</span>
        </div>
        <div class="multi-select-dropdown" id="platforms-dropdown"></div>
      </div>
    </div>

    <div class="field-group">
      <label class="field-label">Category</label>
      <div class="multi-select" id="field-category">
        <input type="text" id="category-input" placeholder="Select or type new..." autocomplete="off">
        <div class="multi-select-dropdown" id="category-dropdown"></div>
      </div>
    </div>

    <div class="field-group">
      <label class="field-label">Script Arguments</label>
      <div class="tag-input-wrap" id="args-wrap">
        <div id="args-tags"></div>
        <input class="tag-input" id="args-input" placeholder="Type and press Enter" autocomplete="off">
      </div>
    </div>

    <div class="field-group">
      <label class="field-label">Environment Variables</label>
      <div class="tag-input-wrap" id="env-wrap">
        <div id="env-tags"></div>
        <input class="tag-input" id="env-input" placeholder="KEY=VALUE, press Enter" autocomplete="off">
      </div>
    </div>

    <div class="field-group">
      <label class="field-label">Timeout (seconds)</label>
      <input type="number" id="field-timeout" min="5" value="90">
    </div>

    <div class="field-group">
      <label class="field-label">Syntax</label>
      <input type="text" id="field-syntax" autocomplete="off">
    </div>

    <div class="field-group">
      <div class="checkbox-group">
        <input type="checkbox" id="field-run-as-user">
        <label for="field-run-as-user">Run As User (Windows only)</label>
      </div>
    </div>
  </div>

  <div id="bottom-bar">
    <div id="agent-select-wrap">
      <input type="text" id="agent-search" placeholder="Select agent to test on..." autocomplete="off">
      <div id="agent-loading">Loading agents...</div>
      <div id="agent-error"></div>
      <div id="agent-dropdown"></div>
    </div>
    <div id="action-buttons">
      <button id="btn-test-agent" disabled>Test Script</button>
      <button id="btn-test-server" disabled>Test on Server</button>
    </div>
    <div id="test-result"></div>
  </div>
</div>

<script>
(function() {
  const vscode = acquireVsCodeApi();
  let metadata = null;
  let hasScript = false;
  let configValid = false;
  let agents = [];
  let selectedAgentId = null;
  let categories = [];

  const platformOptions = ['Windows', 'Linux', 'macOS'];
  let selectedPlatforms = [];
  let selectedCategory = '';
  let argsList = [];
  let envList = [];
  let fieldGeneration = 0;

  const el = id => document.getElementById(id);

  function send(type, data) { vscode.postMessage({ type, ...data }); }

  function sendField(field, value) {
    const gen = ++fieldGeneration;
    setTimeout(() => {
      if (gen !== fieldGeneration) return;
      if (!hasScript) return;
      send('updateField', { field, value });
    }, 400);
  }

  // --- Field change handlers ---
  el('field-name').addEventListener('input', function() { sendField('name', this.value); });
  el('field-description').addEventListener('input', function() { sendField('description', this.value); });
  el('field-shell').addEventListener('change', function() { sendField('shell', this.value); });
  el('field-timeout').addEventListener('change', function() { sendField('default_timeout', String(this.value)); });
  el('field-syntax').addEventListener('input', function() { sendField('syntax', this.value); });
  el('field-run-as-user').addEventListener('change', function() { sendField('run_as_user', this.checked ? 'true' : 'false'); });

  // --- Supported Platforms multi-select ---
  function renderPlatformOptions() {
    const dd = el('platforms-dropdown');
    dd.innerHTML = platformOptions.map(p => \`
      <label class="multi-select-option">
        <input type="checkbox" value="\${p}" \${selectedPlatforms.includes(p) ? 'checked' : ''}>
        \${p}
      </label>
    \`).join('');
    dd.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', function() {
        if (this.checked) {
          if (!selectedPlatforms.includes(this.value)) selectedPlatforms.push(this.value);
        } else {
          selectedPlatforms = selectedPlatforms.filter(p => p !== this.value);
        }
        renderPlatformTrigger();
        sendField('supported_platforms', JSON.stringify(selectedPlatforms));
      });
    });
  }

  function renderPlatformTrigger() {
    const trigger = el('platforms-trigger');
    const placeholder = el('platforms-placeholder');
    const chips = trigger.querySelectorAll('.multi-chip');
    chips.forEach(c => c.remove());
    placeholder.textContent = selectedPlatforms.length ? '' : 'All supported if blank';
    selectedPlatforms.forEach(p => {
      const chip = document.createElement('span');
      chip.className = 'multi-chip';
      chip.innerHTML = \`\${p} <span class="multi-chip-remove" data-value="\${p}">&times;</span>\`;
      chip.querySelector('.multi-chip-remove').addEventListener('click', function(e) {
        e.stopPropagation();
        selectedPlatforms = selectedPlatforms.filter(x => x !== this.dataset.value);
        renderPlatformTrigger();
        renderPlatformOptions();
        sendField('supported_platforms', JSON.stringify(selectedPlatforms));
      });
      trigger.insertBefore(chip, placeholder);
    });
  }

  el('platforms-trigger').addEventListener('click', function() {
    el('platforms-dropdown').classList.toggle('open');
  });
  el('platforms-trigger').addEventListener('blur', function() {
    setTimeout(() => el('platforms-dropdown').classList.remove('open'), 150);
  });
  renderPlatformOptions();
  renderPlatformTrigger();

  // --- Category input ---
  el('category-input').addEventListener('focus', function() {
    renderCategoryDropdown();
    el('category-dropdown').classList.add('open');
  });
  el('category-input').addEventListener('blur', function() {
    setTimeout(() => el('category-dropdown').classList.remove('open'), 150);
  });
  el('category-input').addEventListener('input', function() {
    renderCategoryDropdown(this.value);
  });
  el('category-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      const val = this.value.trim();
      if (val && val !== selectedCategory) {
        selectedCategory = val;
        this.value = val;
        el('category-dropdown').classList.remove('open');
        sendField('category', val);
      }
    }
  });

  function renderCategoryDropdown(filter) {
    const dd = el('category-dropdown');
    let list = categories;
    if (filter) {
      const f = filter.toLowerCase();
      list = categories.filter(c => c.toLowerCase().includes(f));
      const exact = categories.some(c => c.toLowerCase() === f);
      if (!exact) list = [{ _new: true, name: filter }, ...list];
    }
    dd.innerHTML = list.map(item => {
      if (item._new) return \`<div class="multi-select-option" data-value="\${item.name}">+ Add "\${item.name}"</div>\`;
      return \`<div class="multi-select-option" data-value="\${item}">\${item}</div>\`;
    }).join('');
    dd.querySelectorAll('.multi-select-option').forEach(el => {
      el.addEventListener('mousedown', function(e) {
        e.preventDefault();
        selectedCategory = this.dataset.value;
        el('category-input').value = selectedCategory;
        el('category-dropdown').classList.remove('open');
        sendField('category', selectedCategory);
      });
    });
  }

  // --- Tag inputs (args, env vars) ---
  function setupTagInput(inputId, tagsId, list, onChange) {
    const input = el(inputId);
    const tagsContainer = el(tagsId);

    function renderTags() {
      tagsContainer.innerHTML = list.map((v, i) => \`
        <span class="tag">\${v} <span class="tag-remove" data-index="\${i}">&times;</span></span>
      \`).join('');
      tagsContainer.querySelectorAll('.tag-remove').forEach(el => {
        el.addEventListener('click', function() {
          list.splice(parseInt(this.dataset.index), 1);
          renderTags();
          onChange(list);
        });
      });
    }

    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = this.value.trim();
        if (val) {
          list.push(val);
          this.value = '';
          renderTags();
          onChange(list);
        }
      }
    });

    input.addEventListener('blur', function() {
      const val = this.value.trim();
      if (val) {
        list.push(val);
        this.value = '';
        renderTags();
        onChange(list);
      }
    });

    renderTags();
  }

  setupTagInput('args-input', 'args-tags', argsList, (list) => {
    sendField('args', JSON.stringify(list));
  });
  setupTagInput('env-input', 'env-tags', envList, (list) => {
    sendField('env_vars', JSON.stringify(list));
  });

  // --- Agent search ---
  el('agent-search').addEventListener('focus', function() {
    renderAgentDropdown(this.value.toLowerCase());
    el('agent-dropdown').classList.add('open');
  });
  el('agent-search').addEventListener('blur', function() {
    setTimeout(() => el('agent-dropdown').classList.remove('open'), 150);
  });
  el('agent-search').addEventListener('input', function() {
    renderAgentDropdown(this.value.toLowerCase());
    el('agent-dropdown').classList.add('open');
  });

  function renderAgentDropdown(filter) {
    const dd = el('agent-dropdown');
    const list = agents.filter(a => !filter || a.hostname.toLowerCase().includes(filter) || (a.agent_id && a.agent_id.toLowerCase().includes(filter)));
    dd.innerHTML = list.map(a => \`
      <div class="agent-option \${selectedAgentId === a.agent_id ? 'selected' : ''}" data-id="\${a.agent_id}">
        \${a.hostname} <span class="agent-plat">\${a.plat || ''}</span>
      </div>
    \`).join('');
    dd.querySelectorAll('.agent-option').forEach(el => {
      el.addEventListener('mousedown', function(e) {
        e.preventDefault();
        selectedAgentId = this.dataset.id;
        el('agent-search').value = this.textContent.trim();
        el('agent-dropdown').classList.remove('open');
        updateButtons();
      });
    });
  }

  function updateButtons() {
    const hasBody = hasScript && metadata && metadata.script_body;
    el('btn-test-agent').disabled = !selectedAgentId || !hasBody;
    el('btn-test-server').disabled = !hasBody;
  }

  // --- Test actions ---
  el('btn-test-agent').addEventListener('click', function() {
    if (!selectedAgentId || !hasScript) return;
    send('testOnAgent', { agentId: selectedAgentId });
  });

  el('btn-test-server').addEventListener('click', function() {
    if (!hasScript) return;
    send('testOnServer', {});
  });

  // --- Message handler ---
  window.addEventListener('message', event => {
    const msg = event.data;
    switch (msg.type) {
      case 'init':
        configValid = msg.configValid;
        if (configValid && hasScript) {
          el('editor-panel').style.display = 'flex';
          el('no-script').style.display = 'none';
          el('no-config').style.display = 'none';
        }
        break;

      case 'metadataUpdate':
        fieldGeneration++;
        hasScript = msg.hasScript;
        metadata = msg.metadata;
        if (!configValid) {
          el('no-script').style.display = 'none';
          el('editor-panel').style.display = 'none';
          el('no-config').style.display = 'flex';
          return;
        }
        if (!hasScript || !metadata) {
          el('editor-panel').style.display = 'none';
          el('no-script').style.display = 'flex';
          el('no-config').style.display = 'none';
          return;
        }
        el('no-script').style.display = 'none';
        el('no-config').style.display = 'none';
        el('editor-panel').style.display = 'flex';

        // Update form fields
        el('field-name').value = metadata.name || '';
        el('field-description').value = metadata.description || '';
        el('field-shell').value = metadata.shell || 'powershell';
        el('field-timeout').value = metadata.default_timeout || 90;
        el('field-syntax').value = metadata.syntax || '';
        el('field-run-as-user').checked = !!metadata.run_as_user;

        // Platforms
        selectedPlatforms = (metadata.supported_platforms || []).filter(p => platformOptions.includes(p));
        renderPlatformOptions();
        renderPlatformTrigger();

        // Category
        selectedCategory = metadata.category || '';
        el('category-input').value = selectedCategory;

        // Args
        argsList.length = 0;
        (metadata.args || []).forEach(a => argsList.push(a));
        const argsWrap = el('args-tags');
        argsWrap.innerHTML = '';
        setupTagInput('args-input', 'args-tags', argsList, (list) => {
          sendField('args', JSON.stringify(list));
        });

        // Env vars
        envList.length = 0;
        (metadata.env_vars || []).forEach(e => envList.push(e));
        const envWrap = el('env-tags');
        envWrap.innerHTML = '';
        setupTagInput('env-input', 'env-tags', envList, (list) => {
          sendField('env_vars', JSON.stringify(list));
        });

        updateButtons();
        break;

      case 'agentsUpdate':
        agents = msg.agents || [];
        el('agent-loading').style.display = 'none';
        el('agent-error').style.display = 'none';
        el('agent-search').disabled = false;
        el('agent-search').placeholder = 'Select agent to test on...';
        renderAgentDropdown(el('agent-search').value.toLowerCase());
        break;

      case 'agentsLoading':
        el('agent-loading').style.display = 'block';
        el('agent-error').style.display = 'none';
        el('agent-search').disabled = true;
        el('agent-search').placeholder = 'Loading...';
        break;

      case 'agentsError':
        el('agent-loading').style.display = 'none';
        el('agent-error').textContent = msg.error || 'Failed to load agents';
        el('agent-error').style.display = 'block';
        el('agent-search').disabled = false;
        break;

      case 'testResult':
        showTestResult(msg.result);
        break;

      case 'testError':
        showTestResult({ error: msg.error });
        break;

      case 'categoriesUpdate':
        categories = msg.categories || [];
        break;
    }
  });

  function showTestResult(result) {
    const div = el('test-result');
    div.style.display = 'block';
    if (result.error) {
      div.innerHTML = \`<span class="meta-line" style="color:var(--error-fg)">Error: \${result.error}</span>\`;
      return;
    }
    let html = '';
    html += \`<div class="meta-line">Return code: \${result.returncode !== undefined ? result.returncode : '?'}</div>\`;
    html += \`<div class="meta-line">Execution time: \${result.execution_time || '?'}s</div>\`;
    if (result.stdout) {
      html += \`<div class="meta-line" style="margin-top:4px">STDOUT:</div>\${escapeHtml(result.stdout)}\`;
    }
    if (result.stderr) {
      html += \`<div class="meta-line" style="margin-top:4px;color:var(--error-fg)">STDERR:</div>\${escapeHtml(result.stderr)}\`;
    }
    div.innerHTML = html;
  }

  function escapeHtml(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // --- Click-outside for dropdowns ---
  document.addEventListener('click', function(e) {
    if (!el('field-platforms').contains(e.target)) {
      el('platforms-dropdown').classList.remove('open');
    }
    if (!el('field-category').contains(e.target)) {
      el('category-dropdown').classList.remove('open');
    }
    if (!el('agent-select-wrap').contains(e.target)) {
      el('agent-dropdown').classList.remove('open');
    }
  });

  // --- Notify ready ---
  send('ready');
})();
</script>
</body>
</html>`;
}
