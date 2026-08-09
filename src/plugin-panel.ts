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
