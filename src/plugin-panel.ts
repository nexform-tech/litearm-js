/**
 * 插件面板 — 根据 PluginManifest 动态生成设备控制 UI。
 *
 * 每种设备 (夹爪/灵巧手/示教板) 通过 get_plugin_manifest 返回清单 JSON，
 * PluginPanelRenderer 据此自动渲染按钮、滑块、下拉框、状态表。
 */
export interface MethodParam {
  name: string;
  type: string;
  label: string;
  default?: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  required?: boolean;
}

export interface MethodDef {
  name: string;
  label: string;
  category: string;
  description: string;
  params: MethodParam[];
  confirm: string;
  blocking: boolean;
}

export interface UISection {
  title: string;
  layout: string;
  methods: string[];
}

export interface StateField {
  name: string;
  label: string;
  unit: string;
  format: string;
}

export interface PluginManifest {
  plugin_id: string;
  category: string;
  name: string;
  vendor: string;
  model: string;
  icon: string;
  methods: MethodDef[];
  ui_schema: UISection[];
  state_fields: StateField[];
  state_method: string;
}

export interface KitExtensionRef {
  extension_id: string;
  version: string;
  config?: Record<string, unknown>;
}

export interface ExtensionManifest {
  plugin_id?: string;
  extension_id?: string;
  manifest_type: "plugin" | "skill" | "kit";
  name: string;
  version: string;
  min_api_version: string;
  vendor: string;
  model: string;
  icon: string;
  description: string;
  checksum_sha256: string;
  // skill
  skill_kind?: "trajectory" | "prompt" | "preset";
  skill_data?: Record<string, unknown>;
  depends_on?: string[];
  // kit
  extensions?: KitExtensionRef[];
  arm_config?: Record<string, unknown>;
  ui_layout?: Record<string, unknown>;
  // plugin (for backward compat)
  category?: string;
  methods?: MethodDef[];
  ui_schema?: UISection[];
  state_fields?: StateField[];
  state_method?: string;
  // meta
  installed_version?: string;
  installed_at?: string;
  methods_count?: number;
  update_available?: boolean;
}

interface AuditResult {
  format: { passed: boolean; detail: string };
  version: { passed: boolean; detail: string };
  integrity: { passed: boolean; detail: string };
  content: { passed: boolean; level: string; detail: string };
}

type RpcFn = (method: string, kwargs: Record<string, unknown>) => Promise<unknown>;
type LogFn = (msg: string, cls?: string) => void;

/**
 * Dynamic plugin panel renderer.
 *
 * Usage:
 *   const renderer = new PluginPanelRenderer(container, rpcFn, logFn);
 *   const manifest = await arm.device('hand_0').call('get_plugin_manifest');
 *   renderer.render(manifest);
 *   // Poll state:
 *   setInterval(async () => {
 *     const state = await arm.device('hand_0').call(manifest.state_method);
 *     renderer.updateState(state);
 *   }, 500);
 */
export class PluginPanelRenderer {
  private _methodDefs: Map<string, MethodDef> = new Map();
  private _stateFields: StateField[] = [];
  private _stateMethod: string = '';
  private _cardEl: HTMLElement | null = null;

  constructor(
    private _container: HTMLElement,
    private _rpc: RpcFn,
    private _log: LogFn,
    private _titlePrefix: string = '',
  ) {}

  /** Render a plugin manifest into a card. */
  render(manifest: PluginManifest): void {
    // Index methods by name
    this._methodDefs.clear();
    for (const m of manifest.methods) {
      this._methodDefs.set(m.name, m);
    }
    this._stateFields = manifest.state_fields || [];
    this._stateMethod = manifest.state_method || 'get_state';

    const card = document.createElement('div');
    card.className = 'card plug-card';
    card.id = `plugin-${manifest.plugin_id.replace('.', '-')}`;
    this._cardEl = card;

    // Header
    const header = document.createElement('h2');
    header.innerHTML = `${manifest.icon} ${this._titlePrefix}${manifest.name} <span class="badge badge-warn plug-status" id="plug-status-${manifest.plugin_id}">--</span>`;
    card.appendChild(header);

    // Collapse toggle
    header.className = 'collapsible';
    header.onclick = () => {
      header.classList.toggle('collapsed');
      const body = header.nextElementSibling as HTMLElement;
      if (body) body.classList.toggle('hidden');
    };

    const body = document.createElement('div');
    body.className = 'collapse-body';

    // Render each section
    for (const section of manifest.ui_schema) {
      const sec = this._renderSection(section);
      body.appendChild(sec);
    }

    // State display table
    if (this._stateFields.length > 0) {
      const stateDiv = document.createElement('div');
      stateDiv.className = 'plug-state';
      stateDiv.id = `plug-state-${manifest.plugin_id}`;
      const rows = this._stateFields.map(f =>
        `<span class="kv"><span class="k">${f.label}:</span><span class="v" data-field="${f.name}">--</span>${f.unit ? '<span style="font-size:9px;color:#666">'+f.unit+'</span>' : ''}</span>`
      ).join('');
      stateDiv.innerHTML = rows;
      body.appendChild(stateDiv);
    }

    // Refresh button
    const refreshRow = document.createElement('div');
    refreshRow.className = 'row';
    refreshRow.style.marginTop = '8px';
    const btn = document.createElement('button');
    btn.className = 'btn btn-p';
    btn.textContent = '🔄 刷新状态';
    btn.onclick = () => this._callAndUpdate('get_state', {});
    refreshRow.appendChild(btn);
    body.appendChild(refreshRow);

    card.appendChild(body);
    this._container.appendChild(card);
  }

  /** Update state display from a state object. */
  updateState(state: Record<string, unknown>): void {
    if (!this._cardEl) return;

    // Update status badge
    const statusEl = this._cardEl.querySelector('.plug-status');
    if (statusEl) {
      const connected = state.connected !== false && state.state !== 'disconnected';
      statusEl.textContent = connected ? (state.state as string || 'ok') : '离线';
      statusEl.className = 'badge ' + (connected ? 'badge-ok' : 'badge-err');
    }

    // Update state fields
    for (const f of this._stateFields) {
      const el = this._cardEl.querySelector(`[data-field="${f.name}"]`);
      if (!el) continue;
      const val = state[f.name];
      if (val === undefined || val === null) { el.textContent = '--'; continue; }
      el.textContent = this._formatValue(val, f.format);
      // Color: error codes reddish
      if (f.name === 'error_code' && typeof val === 'number' && val > 1) {
        el.className = 'v warn';
      } else {
        el.className = 'v';
      }
    }
  }

  // ── Internal ────────────────────────────────────────────────────────

  private _renderSection(section: UISection): HTMLElement {
    const div = document.createElement('div');
    div.className = 'row';
    div.style.marginTop = '6px';

    // Title
    const label = document.createElement('label');
    label.textContent = section.title;
    label.style.minWidth = '56px';
    div.appendChild(label);

    // Method buttons/controls
    for (const methodName of section.methods) {
      const mdef = this._methodDefs.get(methodName);
      if (!mdef) continue;

      const ctrl = this._renderMethodControl(mdef);
      div.appendChild(ctrl);
    }

    return div;
  }

  private _renderMethodControl(mdef: MethodDef): HTMLElement {
    const hasParams = mdef.params.length > 0;
    const paramsUseInput = hasParams && mdef.params.some(p => p.type !== 'select');

    // Actions with no input params or only selects: simple button
    if (mdef.category === 'action' && !paramsUseInput) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (mdef.category === 'calibration' ? 'btn-d' : 'btn-m');
      btn.textContent = mdef.label;
      btn.title = mdef.description;
      btn.onclick = async () => {
        if (btn.disabled) return;
        if (mdef.confirm && !confirm(mdef.confirm)) return;
        btn.disabled = true;
        btn.textContent = '⏳...';
        try {
          // collect select param values if any
          const kwargs: Record<string, unknown> = {};
          for (const p of mdef.params) {
            if (p.type === 'select') {
              // Find the select element sibling
              const sel = btn.parentElement?.querySelector(`select[data-param="${p.name}"]`) as HTMLSelectElement;
              if (sel) kwargs[p.name] = sel.value;
            }
          }
          const result = await this._rpc(mdef.name, kwargs);
          this._logResult(mdef.label, true, result);
        } catch (e: any) {
          this._logResult(mdef.label, false, e.message || String(e));
        } finally {
          btn.disabled = false;
          btn.textContent = mdef.label;
        }
      };
      return btn;

    // Actions/motion/calibration with input params
    } else if ((mdef.category === 'motion' || mdef.category === 'calibration' || mdef.category === 'action') && paramsUseInput) {
      return this._renderParamButton(mdef);
    }

    // Just a text label for state/custom
    const span = document.createElement('span');
    span.textContent = mdef.label;
    span.title = mdef.description;
    span.style.fontSize = '12px';
    span.style.color = '#888';
    return span;
  }

  private _renderParamButton(mdef: MethodDef): HTMLElement {
    const wrapper = document.createElement('span');
    wrapper.style.display = 'inline-flex';
    wrapper.style.gap = '6px';
    wrapper.style.alignItems = 'center';

    // Inputs for each param
    for (const p of mdef.params) {
      if (p.type === 'select') {
        const sel = document.createElement('select');
        sel.setAttribute('data-param', p.name);
        sel.style.width = '80px';
        if (p.options) {
          for (const o of p.options) {
            const opt = document.createElement('option');
            opt.value = o; opt.textContent = o;
            if (o === p.default) opt.selected = true;
            sel.appendChild(opt);
          }
        }
        wrapper.appendChild(sel);
      } else {
        // Number input
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.setAttribute('data-param', p.name);
        inp.value = String(p.default ?? '');
        if (p.min !== undefined) inp.min = String(p.min);
        if (p.max !== undefined) inp.max = String(p.max);
        if (p.step !== undefined) inp.step = String(p.step);
        inp.style.width = '70px';
        inp.title = p.label;
        inp.placeholder = p.label;

        // Label
        const lbl = document.createElement('span');
        lbl.textContent = p.label;
        lbl.style.fontSize = '10px';
        lbl.style.color = '#888';
        wrapper.appendChild(lbl);
        wrapper.appendChild(inp);
      }
    }

    // Execute button
    const btn = document.createElement('button');
    btn.className = 'btn ' + (mdef.category === 'calibration' ? 'btn-d' : 'btn-p');
    btn.textContent = mdef.label;
    btn.title = mdef.description;
    btn.onclick = async () => {
      if (btn.disabled) return;
      if (mdef.confirm && !confirm(mdef.confirm)) return;
      btn.disabled = true;
      btn.textContent = '⏳...';
      try {
        const kwargs: Record<string, unknown> = {};
        const parent = wrapper.parentElement || wrapper;
        for (const p of mdef.params) {
          const el = parent.querySelector(`[data-param="${p.name}"]`) as HTMLInputElement | HTMLSelectElement;
          if (!el) continue;
          if (p.type === 'select') {
            kwargs[p.name] = (el as HTMLSelectElement).value;
          } else if (p.type === 'float' || p.type === 'int') {
            kwargs[p.name] = parseFloat((el as HTMLInputElement).value) || 0;
          } else {
            kwargs[p.name] = (el as HTMLInputElement).value;
          }
        }
        const result = await this._rpc(mdef.name, kwargs);
        this._logResult(mdef.label, true, result);
      } catch (e: any) {
        this._logResult(mdef.label, false, e.message || String(e));
      } finally {
        btn.disabled = false;
        btn.textContent = mdef.label;
      }
    };
    wrapper.appendChild(btn);
    return wrapper;
  }

  private async _callAndUpdate(method: string, kwargs: Record<string, unknown>): Promise<void> {
    try {
      const result = await this._rpc(method, kwargs);
      if (result && typeof result === 'object') {
        this.updateState(result as Record<string, unknown>);
      }
    } catch (e: any) {
      this._log('刷新失败: ' + (e.message || String(e)), 'e');
    }
  }

  private _logResult(label: string, ok: boolean, result: unknown): void {
    if (ok) {
      const s = typeof result === 'object' ? JSON.stringify(result).slice(0, 120) : String(result);
      this._log(`✓ ${label}: ${s}`);
    } else {
      this._log(`✗ ${label}: ${result}`, 'e');
    }
  }

  private _formatValue(val: unknown, fmt: string): string {
    if (typeof val === 'boolean') {
      if (fmt.startsWith('bool:')) {
        const [_, t, f] = fmt.split(':');
        return val ? (t || '✓') : (f || '✗');
      }
      return val ? '✓' : '✗';
    }
    if (typeof val === 'number') {
      if (fmt === 'hex') return '0x' + val.toString(16).toUpperCase();
      if (fmt === 'int') return String(Math.round(val));
      if (fmt.startsWith('float:')) {
        const digits = parseInt(fmt.split(':')[1] || '1');
        return val.toFixed(digits);
      }
      return val.toFixed(1);
    }
    return String(val);
  }
}

/**
 * Extension store UI renderer.
 *
 * Renders a 3-tab store (已安装/商店/导入) with card grid, search,
 * category filter, install confirm dialog, and update badges.
 *
 * Usage:
 *   const renderer = new ExtensionStoreRenderer(container, rpcFn, logFn);
 *   await renderer.render();
 */
export class ExtensionStoreRenderer {
  private _container: HTMLElement;
  private _rpc: RpcFn;
  private _log: LogFn;
  private _activeTab: string = 'installed';

  constructor(container: HTMLElement, rpc: RpcFn, log: LogFn) {
    this._container = container;
    this._rpc = rpc;
    this._log = log;
  }

  /** Render the full store UI. */
  async render(): Promise<void> {
    this._container.innerHTML = '';

    // Header
    const header = document.createElement('div');
    header.className = 'row';
    header.style.justifyContent = 'space-between';
    header.style.marginBottom = '12px';

    const title = document.createElement('h2');
    title.innerHTML = '🔌 扩展商店';
    title.style.margin = '0';
    header.appendChild(title);

    // Search
    const searchBox = document.createElement('input');
    searchBox.type = 'text';
    searchBox.placeholder = '搜索扩展...';
    searchBox.style.width = '200px';
    searchBox.oninput = () => this._loadTab(this._activeTab, searchBox.value);
    header.appendChild(searchBox);

    this._container.appendChild(header);

    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'row';
    tabs.style.marginBottom = '12px';
    tabs.style.borderBottom = '1px solid #333';
    tabs.style.paddingBottom = '8px';

    for (const tab of [
      { id: 'installed', label: '已安装' },
      { id: 'store', label: '商店' },
      { id: 'import', label: '导入...' },
    ]) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (tab.id === this._activeTab ? 'btn-p' : 'btn-s');
      btn.textContent = tab.label;
      btn.onclick = () => { this._activeTab = tab.id; this._loadTab(tab.id); };
      tabs.appendChild(btn);
    }

    this._container.appendChild(tabs);

    // Content area
    const content = document.createElement('div');
    content.id = 'store-content';
    this._container.appendChild(content);

    await this._loadTab(this._activeTab);
  }

  private async _loadTab(tab: string, search = ''): Promise<void> {
    const content = this._container.querySelector('#store-content') as HTMLElement;
    if (!content) return;
    content.innerHTML = '<p style="color:#888">加载中...</p>';

    try {
      switch (tab) {
        case 'installed':
          await this._renderInstalledTab(content, search);
          break;
        case 'store':
          await this._renderStoreTab(content, search);
          break;
        case 'import':
          this._renderImportTab(content);
          break;
      }
    } catch (e: any) {
      content.innerHTML = `<p class="e">加载失败: ${e.message || e}</p>`;
    }
  }

  private async _renderInstalledTab(container: HTMLElement, search: string): Promise<void> {
    const installed: any[] = await this._rpc('list_installed_extensions', {});
    const active: Record<string, any> = await this._rpc('get_active_devices', {});

    let filtered = installed || [];
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter((e: any) =>
        (e.name || '').toLowerCase().includes(q) ||
        (e.plugin_id || e.extension_id || '').toLowerCase().includes(q)
      );
    }

    if (filtered.length === 0) {
      container.innerHTML = '<p style="color:#888">暂无已安装扩展。</p>';
      return;
    }

    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:10px;';

    for (const ext of filtered) {
      const card = this._renderCard(ext, 'installed', active);
      grid.appendChild(card);
    }
    container.appendChild(grid);
  }

  private async _renderStoreTab(container: HTMLElement, search: string): Promise<void> {
    const available: any[] = await this._rpc('list_available_extensions', { search });
    const updates: any[] = await this._rpc('check_extension_updates', {});

    if (!available || available.length === 0) {
      container.innerHTML = '<p style="color:#888">商店暂无可用扩展。</p>';
      return;
    }

    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:10px;';

    for (const ext of available) {
      const upd = updates.find((u: any) =>
        (u.extension_id || u.plugin_id) === (ext.extension_id || ext.plugin_id));
      if (upd) ext.update_available = true;
      const card = this._renderCard(ext, 'store', {});
      grid.appendChild(card);
    }
    container.appendChild(grid);
  }

  private _renderImportTab(container: HTMLElement): void {
    container.innerHTML = `
      <div class="card" style="max-width:500px">
        <h3>📥 从外部源安装</h3>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
          <div>
            <label>GitHub 地址</label>
            <input id="import-github" type="text" placeholder="https://github.com/user/repo" style="width:100%">
            <button class="btn btn-p" onclick="(window as any)._doImportGitHub?.()" style="margin-top:6px">安装</button>
          </div>
          <div>
            <label>直链 URL</label>
            <input id="import-url" type="text" placeholder="https://example.com/ext.tar.gz" style="width:100%">
            <button class="btn btn-p" onclick="(window as any)._doImportURL?.()" style="margin-top:6px">安装</button>
          </div>
          <div style="border-top:1px solid #333;padding-top:10px">
            <label>扩展 ID (从 Registry)</label>
            <input id="import-registry" type="text" placeholder="skill.gentle_grasp" style="width:100%">
            <button class="btn btn-p" onclick="(window as any)._doImportRegistry?.()" style="margin-top:6px">安装</button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderCard(ext: any, context: string, active: Record<string, any>): HTMLElement {
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cssText = 'padding:12px; cursor:default;';

    const eid = ext.extension_id || ext.plugin_id || '';
    const mfType = ext.manifest_type || (ext.category ? 'plugin' : 'unknown');
    const isActive = Object.values(active).some((a: any) => a.plugin_id === eid);

    let badgeText = '';
    let badgeCls = 'badge-warn';
    switch (mfType) {
      case 'plugin': badgeText = `设备驱动·${ext.category || ''}`; badgeCls = 'badge-ok'; break;
      case 'skill': badgeText = `原子能力·${ext.skill_kind || ''}`; badgeCls = 'badge-warn'; break;
      case 'kit': badgeText = `专家套件·${(ext.extensions || []).length}个扩展`; badgeCls = 'badge-ok'; break;
    }

    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong>${ext.icon || '📦'} ${ext.name || eid}</strong>
        <span style="font-size:11px;color:#888">v${ext.version || '1.0.0'}</span>
      </div>
      <div style="margin:6px 0">
        <span class="badge ${badgeCls}">${badgeText}</span>
        ${isActive ? '<span class="badge badge-ok">活跃</span>' : ''}
        ${ext.update_available ? '<span class="badge badge-warn">⬆ 可更新</span>' : ''}
      </div>
      <div style="font-size:11px;color:#888;margin:4px 0">${ext.vendor || ''} ${ext.model || ''}</div>
      <div style="font-size:11px;color:#888;margin:4px 0">${(ext.description || '').slice(0, 80)}</div>
      <div style="margin-top:8px;display:flex;gap:6px" class="store-card-btns" data-eid="${eid}" data-mftype="${mfType}">
        ${this._renderCardButtons(ext, context, isActive)}
      </div>
    `;
    return card;
  }

  private _renderCardButtons(ext: any, context: string, isActive: boolean): string {
    const eid = ext.extension_id || ext.plugin_id || '';
    const mfType = ext.manifest_type || (ext.category ? 'plugin' : 'unknown');

    if (context === 'installed') {
      let btns = '';
      if (mfType === 'plugin' && !isActive) {
        btns += `<button class="btn btn-g" onclick="(window as any)._doEnable?.('${eid}')">启用</button>`;
      }
      if (mfType === 'kit') {
        btns += `<button class="btn btn-p" onclick="(window as any)._doKitDetail?.('${eid}')">详情</button>`;
      }
      if (ext.update_available) {
        btns += `<button class="btn btn-warn" onclick="(window as any)._doUpdate?.('${eid}')">⬆ 更新</button>`;
      }
      btns += `<button class="btn btn-d" onclick="(window as any)._doUninstall?.('${eid}')">卸载</button>`;
      return btns;
    }

    // store context — skill preview button deferred to Phase 2
    if (mfType === 'kit') {
      return `<button class="btn btn-p" onclick="(window as any)._doInstallKit?.('${eid}')">安装套件</button>`;
    }
    return `<button class="btn btn-p" onclick="(window as any)._doInstall?.('${eid}')">安装</button>`;
  }
}

/**
 * Show an install confirmation dialog with security audit results.
 */
export function showInstallConfirm(
  manifest: ExtensionManifest,
  audit: AuditResult,
  onConfirm: () => void,
  onCancel: () => void
): void {
  const existing = document.getElementById('install-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'install-modal';
  overlay.style.cssText = `
    position:fixed; top:0; left:0; right:0; bottom:0;
    background:rgba(0,0,0,0.6); display:flex;
    align-items:center; justify-content:center; z-index:9999;
  `;

  const shaOk = audit.integrity.passed;
  const apiOk = audit.version.passed;
  const contentLevel = audit.content?.level || 'safe';
  const contentColor = contentLevel === 'critical' ? '#e94560'
    : contentLevel === 'warning' ? '#e9c545' : '#4ecca3';

  overlay.innerHTML = `
    <div class="card" style="max-width:420px;width:90%;background:#16213e;border:1px solid #333">
      <h2>${manifest.icon || '📦'} ${manifest.name} v${manifest.version || '1.0.0'}</h2>
      <div style="border-bottom:1px solid #333;padding-bottom:10px;margin-bottom:10px">
        <div style="font-size:12px;color:#888">厂商: ${manifest.vendor || '-'} &nbsp; 模型: ${manifest.model || '-'}</div>
        <div style="font-size:12px;color:#888">类型: ${manifest.manifest_type || 'plugin'}${manifest.skill_kind ? ' · ' + manifest.skill_kind : ''}</div>
        <div style="font-size:12px;color:#888">${(manifest.description || '').slice(0, 120)}</div>
      </div>
      <div style="font-size:12px;line-height:1.8">
        <div style="color:${shaOk ? '#4ecca3' : '#e94560'}">🔒 SHA256: ${shaOk ? '✓ ' + (manifest.checksum_sha256 || '-').slice(0,16) + '...' : '✗ 校验失败'}</div>
        <div style="color:${apiOk ? '#4ecca3' : '#e94560'}">📟 API: ${audit.version.detail}</div>
        <div style="color:${contentColor}">🛡 内容扫描: ${audit.content?.detail || '-'} (${contentLevel})</div>
        <div>📦 依赖: ${(manifest.depends_on || []).length ? manifest.depends_on!.join(', ') : '无'}</div>
      </div>
      <div style="margin-top:14px;display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-s" id="install-cancel">取消</button>
        <button class="btn btn-p" id="install-confirm" ${!shaOk ? 'disabled' : ''}>确认安装</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#install-cancel')!.addEventListener('click', () => {
    overlay.remove();
    onCancel();
  });
  overlay.querySelector('#install-confirm')!.addEventListener('click', () => {
    overlay.remove();
    onConfirm();
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { overlay.remove(); onCancel(); }
  });
}
