import { describe, it, expect } from 'vitest';
import { getWebviewHtml } from '../views/scriptEditorWebview';

describe('getWebviewHtml', () => {
  it('embeds configValid=true when config is valid', () => {
    const html = getWebviewHtml(true);
    expect(html).toContain('__initConfigValid=true');
  });

  it('embeds configValid=false when config is invalid', () => {
    const html = getWebviewHtml(false);
    expect(html).toContain('__initConfigValid=false');
  });

  it('embeds the config error message', () => {
    const html = getWebviewHtml(false, 'trmm.apiUrl is not configured');
    expect(html).toContain('__initConfigError');
    expect(html).toContain('trmm.apiUrl is not configured');
  });

  it('embeds empty config error when none given', () => {
    const html = getWebviewHtml(true);
    expect(html).toContain('__initConfigError=""');
  });

  it('includes Open Settings link in no-config div', () => {
    const html = getWebviewHtml(false, 'trmm.apiKey is missing');
    expect(html).toContain('Open Settings');
    expect(html).toContain('id="open-settings-link"');
  });

  it('immediately hides no-script and editor-panel when config is invalid', () => {
    const html = getWebviewHtml(false, 'missing config');
    expect(html).toContain("el('no-script').style.display = 'none'");
    expect(html).toContain("el('editor-panel').style.display = 'none'");
    expect(html).toContain("el('no-config').style.display = 'flex'");
  });
});
