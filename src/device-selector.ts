/**
 * @file device-selector.ts
 * @brief 末端设备选择器 — 下拉选类型 → 连接/断开 → 复用 PluginPanelRenderer 渲染面板。
 *
 * 无插件机制:类型列表来自 server 的 list_device_types(源码内置注册表)。
 * 连接由 server 按需 fork device_daemon;重启后 server 自动恢复,前端仅反映状态。
 */
import { PluginPanelRenderer, type PluginManifest } from './plugin-panel';

export interface DeviceTypeInfo {
  category: string;
  subtype: string;
  name: string;
  icon: string;
  model?: string;
  vendor?: string;
}

export interface ActiveDeviceInfo {
  configured: boolean;
  enabled: boolean;
  online: boolean;
  category: string;
  subtype: string;
  device_id: string;
  can_iface: string;
}

/** 选择器需要的 Arm 子集(便于测试注入)。 */
export interface DeviceArmApi {
  listDeviceTypes(): Promise<DeviceTypeInfo[]>;
  connectDevice(category: string, subtype: string,
    opts?: { deviceId?: string; canIface?: string }): Promise<{ ok: boolean; error?: string }>;
  disconnectDevice(deviceId?: string): Promise<{ ok: boolean }>;
  getActiveDevice(deviceId?: string): Promise<ActiveDeviceInfo>;
  getDeviceManifest(deviceId?: string): Promise<PluginManifest | null>;
  device(deviceId: string): { call(method: string, kwargs?: Record<string, unknown>): Promise<unknown> };
}

type LogFn = (msg: string, cls?: string) => void;

const DEVICE_ID = 'end_0';

export class DeviceSelector {
  private _types: DeviceTypeInfo[] = [];
  private _panel: PluginPanelRenderer | null = null;
  private _panelHost: HTMLElement;
  private _statePoll: ReturnType<typeof setInterval> | null = null;

  constructor(
    private _container: HTMLElement,
    private _arm: DeviceArmApi,
    private _log: LogFn = () => {},
  ) {
    this._panelHost = document.createElement('div');
  }

  /** 初始化:拉类型列表 + 当前状态,渲染选择器。 */
  async init(): Promise<void> {
    this._container.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'card';

    const header = document.createElement('h2');
    header.textContent = '末端设备';
    card.appendChild(header);

    const row = document.createElement('div');
    row.className = 'row';
    row.style.gap = '8px';

    const select = document.createElement('select');
    select.id = 'device-type-select';
    select.style.minWidth = '160px';
    row.appendChild(select);

    const connectBtn = document.createElement('button');
    connectBtn.className = 'btn btn-p';
    connectBtn.textContent = '连接';
    connectBtn.id = 'device-connect-btn';
    row.appendChild(connectBtn);

    const disconnectBtn = document.createElement('button');
    disconnectBtn.className = 'btn btn-d';
    disconnectBtn.textContent = '断开';
    disconnectBtn.id = 'device-disconnect-btn';
    row.appendChild(disconnectBtn);

    const status = document.createElement('span');
    status.id = 'device-status';
    status.className = 'badge badge-warn';
    status.textContent = '未连接';
    row.appendChild(status);

    card.appendChild(row);
    card.appendChild(this._panelHost);
    this._container.appendChild(card);

    // 拉类型列表
    try {
      this._types = await this._arm.listDeviceTypes();
    } catch (e: any) {
      this._log('获取末端类型失败: ' + (e?.message || e), 'e');
      this._types = [];
    }
    for (const t of this._types) {
      const opt = document.createElement('option');
      opt.value = `${t.category}:${t.subtype}`;
      opt.textContent = `${t.icon} ${t.name}`;
      select.appendChild(opt);
    }

    connectBtn.onclick = () => this._onConnect(select.value, connectBtn);
    disconnectBtn.onclick = () => this._onDisconnect(disconnectBtn);

    // 反映当前状态(重启自动恢复的末端也会在此显示)
    await this._refreshActive(select);
  }

  private async _refreshActive(select: HTMLSelectElement): Promise<void> {
    let active: ActiveDeviceInfo;
    try {
      active = await this._arm.getActiveDevice(DEVICE_ID);
    } catch {
      return;
    }
    if (active.configured && active.category && active.subtype) {
      select.value = `${active.category}:${active.subtype}`;
    }
    if (active.online) {
      this._setStatus('在线', 'badge-ok');
      await this._renderPanel();
    } else if (active.configured && active.enabled) {
      this._setStatus('离线(启动失败,可重连)', 'badge-err');
    } else {
      this._setStatus('未连接', 'badge-warn');
    }
  }

  private async _onConnect(value: string, btn: HTMLButtonElement): Promise<void> {
    const [category, subtype] = value.split(':');
    if (!category || !subtype) return;
    btn.disabled = true;
    this._setStatus('连接中...', 'badge-warn');
    try {
      const r = await this._arm.connectDevice(category, subtype, { deviceId: DEVICE_ID });
      if (r.ok) {
        this._setStatus('在线', 'badge-ok');
        this._log(`✓ 末端已连接: ${category}/${subtype}`);
        await this._renderPanel();
      } else {
        this._setStatus('连接失败', 'badge-err');
        this._log(`✗ 连接失败: ${r.error || '未知错误'}`, 'e');
      }
    } catch (e: any) {
      this._setStatus('连接失败', 'badge-err');
      this._log('✗ 连接异常: ' + (e?.message || e), 'e');
    } finally {
      btn.disabled = false;
    }
  }

  private async _onDisconnect(btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    try {
      await this._arm.disconnectDevice(DEVICE_ID);
      this._setStatus('未连接', 'badge-warn');
      this._log('末端已断开');
      this._clearPanel();
    } catch (e: any) {
      this._log('断开异常: ' + (e?.message || e), 'e');
    } finally {
      btn.disabled = false;
    }
  }

  private async _renderPanel(): Promise<void> {
    const manifest = await this._arm.getDeviceManifest(DEVICE_ID);
    if (!manifest) return;
    this._clearPanel();
    const dev = this._arm.device(DEVICE_ID);
    this._panel = new PluginPanelRenderer(
      this._panelHost,
      (method, kwargs) => dev.call(method, kwargs),
      this._log,
    );
    this._panel.render(manifest);
    // 50Hz 太快;末端状态 2Hz 足够
    this._statePoll = setInterval(async () => {
      try {
        const state = await dev.call('get_state');
        if (state && typeof state === 'object') {
          this._panel?.updateState(state as Record<string, unknown>);
        }
      } catch { /* ignore transient */ }
    }, 500);
  }

  private _clearPanel(): void {
    if (this._statePoll) { clearInterval(this._statePoll); this._statePoll = null; }
    this._panelHost.innerHTML = '';
    this._panel = null;
  }

  private _setStatus(text: string, cls: string): void {
    const el = this._container.querySelector('#device-status');
    if (el) { el.textContent = text; el.className = 'badge ' + cls; }
  }

  /** 释放资源。 */
  dispose(): void { this._clearPanel(); }
}
