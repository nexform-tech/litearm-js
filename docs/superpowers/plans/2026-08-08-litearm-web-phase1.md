# LiteArm Web Phase 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the foundation for the LiteArm Web frontend — project scaffold, 3-column layout, theme system, state management, service layer with mock, and login flow.

**Architecture:** Vue 3 + PrimeVue 4 + TailwindCSS SPA connecting to litearm-server via litearm-js SDK WebSocket. Service layer isolates SDK from components. Mock layer enables development without hardware.

**Tech Stack:** Vite 7, Vue 3.5, TypeScript, PrimeVue 4 (Aura), TailwindCSS 4, Pinia 3, Vue Router 4, Three.js (Phase 2), ECharts (Phase 3)

**Spec:** `docs/superpowers/specs/2026-08-08-litearm-web-design.md`

---

## File Structure

```
litearm-web/
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tsconfig.app.json
├── tsconfig.node.json
├── tailwind.config.ts            # TailwindCSS config (if needed for v4)
├── env.d.ts
├── .env.development
├── .env.production
├── .gitignore
├── public/
│   └── urdf/                     # (Phase 2) URDF model files
├── src/
│   ├── main.ts                   # Entry: create app, install PrimeVue/Pinia/Router
│   ├── App.vue                   # Root: <router-view> + PrimeVue Toast
│   ├── router/
│   │   └── index.ts              # Routes: /login, /workspace, /upgrade
│   ├── stores/
│   │   ├── arm.ts                # Robot state (q/dq/tau/state/faults/temps)
│   │   ├── connection.ts         # WS connection + JWT token
│   │   ├── system.ts             # System stats (CPU/mem/temp)
│   │   ├── motion.ts             # Motion/recording/playback state
│   │   └── ui.ts                 # Theme, dialogs, logs
│   ├── services/
│   │   ├── types.ts              # Shared interfaces (IArmService, etc.)
│   │   ├── arm.ts                # Real ArmService (litearm-js SDK)
│   │   ├── auth.ts               # JWT login/change-password
│   │   ├── system.ts             # System API
│   │   ├── settings.ts           # Settings API
│   │   ├── trajectory.ts         # Trajectory API
│   │   ├── factory.ts            # createArmService() — mock or real
│   │   └── mock/
│   │       ├── arm-mock.ts       # Mock IArmService with simulated state
│   │       └── system-mock.ts    # Mock system stats
│   ├── views/
│   │   ├── LoginView.vue         # Login page
│   │   ├── WorkspaceView.vue     # Main 3-column layout
│   │   └── UpgradeView.vue       # OTA placeholder
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppTopbar.vue     # Top bar (logo + buttons + connection + theme)
│   │   │   └── AppFooter.vue     # Bottom status bar
│   │   ├── control/
│   │   │   └── (Phase 2)
│   │   ├── viewport/
│   │   │   └── (Phase 2)
│   │   └── common/
│   │       └── StatusBadge.vue   # State badge (ready/moving/error)
│   ├── composables/
│   │   ├── useArmState.ts        # Subscribe to SDK state broadcast → armStore
│   │   └── useTheme.ts           # Dark/light toggle + persistence
│   └── assets/
│       └── styles/
│           └── main.css          # TailwindCSS imports + PrimeVue overrides
```

---

### Task 1: Initialize Project

**Files:**
- Create: `litearm-web/` (entire project scaffold)

- [ ] **Step 1: Create project directory and git init**

```bash
mkdir -p /home/llx/litearm-web
cd /home/llx/litearm-web
git init
```

- [ ] **Step 2: Create package.json**

Write `/home/llx/litearm-web/package.json`:

```json
{
  "name": "litearm-web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "vue-tsc --noEmit"
  },
  "dependencies": {
    "vue": "^3.5.0",
    "vue-router": "^4.4.0",
    "pinia": "^3.0.0",
    "primevue": "^4.2.0",
    "@primevue/themes": "^4.2.0",
    "primeicons": "^7.0.0",
    "tailwindcss": "^4.0.0"
  },
  "devDependencies": {
    "@vitejs/plugin-vue": "^5.0.0",
    "vite": "^6.0.0",
    "vue-tsc": "^2.0.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
cd /home/llx/litearm-web
npm install
```

- [ ] **Step 4: Create Vite config**

Write `/home/llx/litearm-web/vite.config.ts`:

```typescript
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 3000,
    host: true,
  },
})
```

- [ ] **Step 5: Create TypeScript configs**

Write `/home/llx/litearm-web/tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

Write `/home/llx/litearm-web/tsconfig.app.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "preserve",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.vue", "env.d.ts"]
}
```

Write `/home/llx/litearm-web/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

Write `/home/llx/litearm-web/env.d.ts`:

```typescript
/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface ImportMetaEnv {
  readonly VITE_SERVER_ENDPOINT: string
  readonly VITE_USE_MOCK: string
  readonly VITE_AUTH_URL: string
}
```

- [ ] **Step 6: Create .gitignore and env files**

Write `/home/llx/litearm-web/.gitignore`:

```
node_modules
dist
*.local
.vite
```

Write `/home/llx/litearm-web/.env.development`:

```
VITE_SERVER_ENDPOINT=192.168.31.237:7449
VITE_USE_MOCK=true
VITE_AUTH_URL=http://192.168.31.237:7449/api/auth
```

Write `/home/llx/litearm-web/.env.production`:

```
VITE_SERVER_ENDPOINT=
VITE_USE_MOCK=false
VITE_AUTH_URL=
```

- [ ] **Step 7: Create index.html**

Write `/home/llx/litearm-web/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <link rel="icon" type="image/svg+xml" href="/vite.svg" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LiteArm</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 8: Create CSS entry**

Write `/home/llx/litearm-web/src/assets/styles/main.css`:

```css
@import "tailwindcss";
```

- [ ] **Step 9: Commit**

```bash
cd /home/llx/litearm-web
git add -A
git commit -m "chore: initialize litearm-web project scaffold

Vite 6 + Vue 3.5 + PrimeVue 4 + TailwindCSS 4 + TypeScript
Three-column layout target: left (3D+status), center (joint+cartesian),
right (estop+trajectory+device)"
```

---

### Task 2: Main Entry + Router + App.vue

**Files:**
- Create: `src/main.ts`
- Create: `src/App.vue`
- Create: `src/router/index.ts`
- Create: `src/views/LoginView.vue` (placeholder)
- Create: `src/views/WorkspaceView.vue` (placeholder)
- Create: `src/views/UpgradeView.vue` (placeholder)

- [ ] **Step 1: Create router**

Write `/home/llx/litearm-web/src/router/index.ts`:

```typescript
import { createRouter, createWebHistory } from 'vue-router'
import { useConnectionStore } from '@/stores/connection'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
    },
    {
      path: '/',
      name: 'workspace',
      component: () => import('@/views/WorkspaceView.vue'),
    },
    {
      path: '/upgrade',
      name: 'upgrade',
      component: () => import('@/views/UpgradeView.vue'),
    },
  ],
})

router.beforeEach((to) => {
  if (to.name !== 'login') {
    const conn = useConnectionStore()
    if (!conn.token) {
      return { name: 'login' }
    }
  }
})

export default router
```

- [ ] **Step 2: Create placeholder views**

Write `/home/llx/litearm-web/src/views/LoginView.vue`:

```vue
<template>
  <div class="flex items-center justify-center min-h-screen">
    <h1 class="text-2xl">Login (TODO)</h1>
  </div>
</template>
```

Write `/home/llx/litearm-web/src/views/WorkspaceView.vue`:

```vue
<template>
  <div class="flex flex-col h-screen">
    <h1 class="text-2xl p-4">Workspace (TODO)</h1>
  </div>
</template>
```

Write `/home/llx/litearm-web/src/views/UpgradeView.vue`:

```vue
<template>
  <div class="flex items-center justify-center min-h-screen">
    <h1 class="text-2xl">OTA Upgrade (TODO)</h1>
  </div>
</template>
```

- [ ] **Step 3: Create App.vue**

Write `/home/llx/litearm-web/src/App.vue`:

```vue
<template>
  <router-view />
  <Toast />
</template>

<script setup lang="ts">
import Toast from 'primevue/toast'
</script>
```

- [ ] **Step 4: Create main.ts**

Write `/home/llx/litearm-web/src/main.ts`:

```typescript
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primevue/themes/aura'
import ToastService from 'primevue/toastservice'
import App from './App.vue'
import router from './router'
import './assets/styles/main.css'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.dark',
    },
  },
})
app.use(ToastService)

app.mount('#app')
```

- [ ] **Step 5: Verify build**

```bash
cd /home/llx/litearm-web
npx vue-tsc --noEmit
```

Expected: No errors (may warn about unused imports in placeholder views)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add router, App.vue, main.ts with PrimeVue/Pinia/Toast

Routes: /login, / (workspace), /upgrade
Auth guard: redirect to /login if no token"
```

---

### Task 3: Pinia Stores

**Files:**
- Create: `src/stores/arm.ts`
- Create: `src/stores/connection.ts`
- Create: `src/stores/system.ts`
- Create: `src/stores/motion.ts`
- Create: `src/stores/ui.ts`

- [ ] **Step 1: Create arm store**

Write `/home/llx/litearm-web/src/stores/arm.ts`:

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface Fault {
  joint: number
  err_code: number
}

export interface Temperature {
  joint: number
  mos_temp: number
  coil_temp: number
}

export type ArmState =
  | 'disconnected'
  | 'connecting'
  | 'ready'
  | 'moving'
  | 'paused'
  | 'stopped'
  | 'error'
  | 'zero_gravity'
  | 'impedance'
  | 'recording'
  | 'unknown'

export const useArmStore = defineStore('arm', () => {
  const q = ref<number[]>([0, 0, 0, 0, 0, 0, 0])
  const dq = ref<number[]>([0, 0, 0, 0, 0, 0, 0])
  const tau = ref<number[]>([0, 0, 0, 0, 0, 0, 0])
  const state = ref<ArmState>('disconnected')
  const faults = ref<Fault[]>([])
  const temps = ref<Temperature[]>(
    Array.from({ length: 7 }, (_, i) => ({ joint: i, mos_temp: 0, coil_temp: 0 }))
  )

  const hasFaults = computed(() => faults.value.length > 0)
  const maxTemp = computed(() => {
    let max = 0
    for (const t of temps.value) {
      max = Math.max(max, t.mos_temp, t.coil_temp)
    }
    return max
  })

  return { q, dq, tau, state, faults, temps, hasFaults, maxTemp }
})
```

- [ ] **Step 2: Create connection store**

Write `/home/llx/litearm-web/src/stores/connection.ts`:

```typescript
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting'

export const useConnectionStore = defineStore('connection', () => {
  const endpoint = ref('')
  const token = ref(localStorage.getItem('litearm_token') || '')
  const status = ref<ConnectionStatus>('disconnected')

  const isConnected = computed(() => status.value === 'connected')

  function setToken(t: string) {
    token.value = t
    if (t) {
      localStorage.setItem('litearm_token', t)
    } else {
      localStorage.removeItem('litearm_token')
    }
  }

  function clearAuth() {
    setToken('')
    status.value = 'disconnected'
  }

  return { endpoint, token, status, isConnected, setToken, clearAuth }
})
```

- [ ] **Step 3: Create system store**

Write `/home/llx/litearm-web/src/stores/system.ts`:

```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useSystemStore = defineStore('system', () => {
  const cpuPercent = ref(0)
  const memPercent = ref(0)
  const diskPercent = ref(0)
  const boardTemp = ref(0)
  const uptime = ref(0)
  const logs = ref<any[]>([])

  return { cpuPercent, memPercent, diskPercent, boardTemp, uptime, logs }
})
```

- [ ] **Step 4: Create motion store**

Write `/home/llx/litearm-web/src/stores/motion.ts`:

```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'

export type PlaybackStatus = 'idle' | 'playing' | 'paused' | 'stopped'

export const useMotionStore = defineStore('motion', () => {
  const recording = ref(false)
  const recordStartTime = ref(0)
  const playback = ref<PlaybackStatus>('idle')
  const trajectories = ref<any[]>([])
  const speedScale = ref(50)

  return { recording, recordStartTime, playback, trajectories, speedScale }
})
```

- [ ] **Step 5: Create UI store**

Write `/home/llx/litearm-web/src/stores/ui.ts`:

```typescript
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const theme = ref<'dark' | 'light'>(
    (localStorage.getItem('litearm_theme') as 'dark' | 'light') || 'dark'
  )
  const settingsDialog = ref(false)
  const logsExpanded = ref(false)

  function toggleTheme() {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
    localStorage.setItem('litearm_theme', theme.value)
    applyTheme()
  }

  function applyTheme() {
    document.documentElement.classList.toggle('dark', theme.value === 'dark')
  }

  return { theme, settingsDialog, logsExpanded, toggleTheme, applyTheme }
})
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add Pinia stores (arm, connection, system, motion, ui)

armStore: q/dq/tau/state/faults/temps from SDK broadcast
connectionStore: endpoint/token/status with localStorage JWT
systemStore: CPU/mem/disk/temp/uptime/logs
motionStore: recording/playback/trajectories/speedScale
uiStore: dark/light theme with persistence"
```

---

### Task 4: Service Layer Types + Mock

**Files:**
- Create: `src/services/types.ts`
- Create: `src/services/mock/arm-mock.ts`
- Create: `src/services/mock/system-mock.ts`
- Create: `src/services/factory.ts`

- [ ] **Step 1: Create service interface types**

Write `/home/llx/litearm-web/src/services/types.ts`:

```typescript
import type { ArmState, Fault, Temperature } from '@/stores/arm'

export interface RobotSnapshot {
  q: number[]
  dq: number[]
  tau: number[]
  state: ArmState
  faults: Fault[]
  temps: Temperature[]
}

export interface MoveOptions {
  speed?: number
  settle_s?: number
}

export interface IArmService {
  connect(endpoint: string, token?: string): Promise<void>
  disconnect(): void
  readonly connected: boolean

  // State
  getState(): RobotSnapshot | null
  onState(cb: (state: RobotSnapshot) => void): () => void

  // Motion
  movej(q_target: number[], opts?: MoveOptions): Promise<void>
  movel(pose: number[][], opts?: MoveOptions): Promise<void>
  movec(via: number[][], goal: number[][], opts?: MoveOptions): Promise<void>
  movep(poses: number[][][], opts?: MoveOptions): Promise<void>
  hold(): Promise<void>
  zeroGravity(): Promise<void>

  // Kinematics
  fk(q: number[]): Promise<{ position: number[]; rotation: number[][] }>
  ik(pos: number[], R: number[][], q_seed?: number[]): Promise<{ q: number[]; success: boolean }>
  getTcpPose(): Promise<{ position: number[]; rotation: number[][] }>

  // Control
  requestStop(): void
  clearStop(): Promise<void>
  clearFaults(): Promise<void>

  // Parameters
  getGains(): Promise<{ kp: number[]; kd: number[] }>
  setGains(kp?: number[], kd?: number[]): Promise<void>
  getPayload(): Promise<{ mass: number; com: number[] }>
  setPayload(mass: number, com?: number[]): Promise<void>

  // Device (end effector)
  deviceOpen(id: string): Promise<void>
  deviceClose(id: string): Promise<void>
  deviceSetForce(id: string, force: number): Promise<void>
  deviceSetWidth(id: string, width: number): Promise<void>
  deviceGetWidth(id: string): Promise<number>
}

export interface ISystemService {
  getStats(): Promise<{ cpu: number; mem: number; disk: number; temp: number; uptime: number }>
  getLogs(page: number, size: number, search?: string): Promise<{ logs: any[]; total: number }>
  restartService(): Promise<void>
}
```

- [ ] **Step 2: Create mock arm service**

Write `/home/llx/litearm-web/src/services/mock/arm-mock.ts`:

```typescript
import type { IArmService, RobotSnapshot, MoveOptions } from '../types'
import type { ArmState } from '@/stores/arm'

export class MockArmService implements IArmService {
  private _connected = false
  private _q = [0, 0.5, 0, -1.0, 0, 0.6, 0]
  private _state: ArmState = 'ready'
  private _listeners: Array<(s: RobotSnapshot) => void> = []
  private _interval: ReturnType<typeof setInterval> | null = null

  get connected() { return this._connected }

  async connect(_endpoint: string, _token?: string): Promise<void> {
    this._connected = true
    this._state = 'ready'
    this._interval = setInterval(() => this._broadcast(), 50) // 20Hz mock
  }

  disconnect(): void {
    this._connected = false
    if (this._interval) { clearInterval(this._interval); this._interval = null }
  }

  getState(): RobotSnapshot | null {
    return this._snapshot()
  }

  onState(cb: (state: RobotSnapshot) => void): () => void {
    this._listeners.push(cb)
    return () => { this._listeners = this._listeners.filter(l => l !== cb) }
  }

  async movej(q_target: number[], _opts?: MoveOptions): Promise<void> {
    this._state = 'moving'
    // Simulate gradual movement
    const steps = 20
    for (let i = 0; i <= steps; i++) {
      await new Promise(r => setTimeout(r, 50))
      for (let j = 0; j < 7; j++) {
        this._q[j] += (q_target[j] - this._q[j]) / (steps - i)
      }
    }
    this._q = [...q_target]
    this._state = 'ready'
  }

  async movel(_pose: number[][], _opts?: MoveOptions): Promise<void> {
    this._state = 'moving'
    await new Promise(r => setTimeout(r, 1000))
    this._state = 'ready'
  }

  async movec(_via: number[][], _goal: number[][], _opts?: MoveOptions): Promise<void> {
    this._state = 'moving'
    await new Promise(r => setTimeout(r, 1500))
    this._state = 'ready'
  }

  async movep(_poses: number[][][], _opts?: MoveOptions): Promise<void> {
    this._state = 'moving'
    await new Promise(r => setTimeout(r, 2000))
    this._state = 'ready'
  }

  async hold(): Promise<void> { this._state = 'ready' }

  async zeroGravity(): Promise<void> { this._state = 'zero_gravity' }

  async fk(q: number[]) {
    return {
      position: [0.3 + q[0] * 0.1, 0.0, 0.5 + q[1] * 0.1],
      rotation: [[1,0,0],[0,1,0],[0,0,1]],
    }
  }

  async ik(_pos: number[], _R: number[][], _q_seed?: number[]) {
    return { q: [...this._q], success: true }
  }

  async getTcpPose() {
    return this.fk(this._q)
  }

  requestStop(): void { this._state = 'stopped' }

  async clearStop(): Promise<void> { this._state = 'ready' }

  async clearFaults(): Promise<void> {}

  async getGains() { return { kp: [360,220,220,100,100,50,50], kd: [20,15,15,8,8,5,5] } }
  async setGains(_kp?: number[], _kd?: number[]): Promise<void> {}

  async getPayload() { return { mass: 0, com: [0, 0, 0] } }
  async setPayload(_mass: number, _com?: number[]): Promise<void> {}

  async deviceOpen(_id: string): Promise<void> {}
  async deviceClose(_id: string): Promise<void> {}
  async deviceSetForce(_id: string, _force: number): Promise<void> {}
  async deviceSetWidth(_id: string, _width: number): Promise<void> {}
  async deviceGetWidth(_id: string): Promise<number> { return 80 }

  private _snapshot(): RobotSnapshot {
    return {
      q: [...this._q],
      dq: this._q.map(() => Math.random() * 0.01 - 0.005),
      tau: this._q.map(() => Math.random() * 2 - 1),
      state: this._state,
      faults: [],
      temps: Array.from({ length: 7 }, (_, i) => ({
        joint: i,
        mos_temp: 35 + Math.random() * 5,
        coil_temp: 30 + Math.random() * 3,
      })),
    }
  }

  private _broadcast(): void {
    const snap = this._snapshot()
    for (const cb of this._listeners) cb(snap)
  }
}
```

- [ ] **Step 3: Create mock system service**

Write `/home/llx/litearm-web/src/services/mock/system-mock.ts`:

```typescript
import type { ISystemService } from '../types'

export class MockSystemService implements ISystemService {
  async getStats() {
    return {
      cpu: 15 + Math.random() * 20,
      mem: 40 + Math.random() * 10,
      disk: 55,
      temp: 42 + Math.random() * 3,
      uptime: Math.floor(Date.now() / 1000) % 86400,
    }
  }

  async getLogs(page: number, size: number, _search?: string) {
    const logs = Array.from({ length: size }, (_, i) => ({
      id: (page - 1) * size + i,
      timestamp: new Date().toISOString(),
      level: ['INFO', 'DEBUG', 'WARNING'][Math.floor(Math.random() * 3)],
      message: `Mock log entry ${(page - 1) * size + i}`,
    }))
    return { logs, total: 100 }
  }

  async restartService(): Promise<void> {
    console.log('[mock] restart_service called')
  }
}
```

- [ ] **Step 4: Create factory**

Write `/home/llx/litearm-web/src/services/factory.ts`:

```typescript
import type { IArmService, ISystemService } from './types'
import { MockArmService } from './mock/arm-mock'
import { MockSystemService } from './mock/system-mock'

export function createArmService(): IArmService {
  // TODO: Phase 2 — add real ArmService when connecting to hardware
  // if (import.meta.env.VITE_USE_MOCK !== 'true') {
  //   return new RealArmService()
  // }
  return new MockArmService()
}

export function createSystemService(): ISystemService {
  return new MockSystemService()
}
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add service layer with types, mock implementations, factory

IArmService interface: connect/motion/kinematics/control/params/device
MockArmService: simulates joint movement, 20Hz state broadcast, IK/FK stubs
MockSystemService: fake CPU/mem/temp stats, mock logs
factory.ts: createArmService/createSystemService (mock by default)"
```

---

### Task 5: Theme System + useTheme Composable

**Files:**
- Create: `src/composables/useTheme.ts`

- [ ] **Step 1: Create useTheme composable**

Write `/home/llx/litearm-web/src/composables/useTheme.ts`:

```typescript
import { onMounted } from 'vue'
import { useUiStore } from '@/stores/ui'

export function useTheme() {
  const ui = useUiStore()

  onMounted(() => {
    ui.applyTheme()
  })

  return {
    theme: ui.theme,
    toggleTheme: ui.toggleTheme,
    isDark: () => ui.theme === 'dark',
  }
}
```

- [ ] **Step 2: Update main.ts to apply theme on startup**

Add to `/home/llx/litearm-web/src/main.ts` before `app.mount`:

```typescript
// Apply theme before mount to avoid flash
const uiStore = useUiStore()
uiStore.applyTheme()
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add useTheme composable with dark/light persistence"
```

---

### Task 6: Three-Column Workspace Layout

**Files:**
- Create: `src/views/WorkspaceView.vue` (full layout)
- Create: `src/components/layout/AppTopbar.vue`
- Create: `src/components/layout/AppFooter.vue`
- Create: `src/components/common/StatusBadge.vue`

- [ ] **Step 1: Create StatusBadge**

Write `/home/llx/litearm-web/src/components/common/StatusBadge.vue`:

```vue
<template>
  <span :class="badgeClass" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium">
    <span :class="dotClass" class="w-2 h-2 rounded-full"></span>
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ArmState } from '@/stores/arm'

const props = defineProps<{ state: ArmState }>()

const badgeClass = computed(() => {
  switch (props.state) {
    case 'ready': return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    case 'moving': return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
    case 'zero_gravity': return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
    case 'error':
    case 'stopped': return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
  }
})

const dotClass = computed(() => {
  switch (props.state) {
    case 'ready': return 'bg-green-500'
    case 'moving': return 'bg-blue-500 animate-pulse'
    case 'zero_gravity': return 'bg-purple-500'
    case 'error':
    case 'stopped': return 'bg-red-500'
    default: return 'bg-gray-500'
  }
})

const label = computed(() => props.state.replace('_', ' '))
</script>
```

- [ ] **Step 2: Create AppTopbar**

Write `/home/llx/litearm-web/src/components/layout/AppTopbar.vue`:

```vue
<template>
  <header class="flex items-center h-12 px-4 bg-gray-900 text-white border-b border-gray-700 shrink-0">
    <!-- Left: Logo -->
    <div class="flex items-center gap-2">
      <span class="text-lg font-bold">LiteArm</span>
    </div>

    <!-- Center: Mode buttons -->
    <div class="flex-1 flex items-center justify-center gap-2">
      <button class="px-3 py-1 text-sm rounded bg-gray-700 hover:bg-gray-600 transition">
        Zero Gravity
      </button>
      <button class="px-3 py-1 text-sm rounded bg-gray-700 hover:bg-gray-600 transition">
        Hold
      </button>
      <button class="px-3 py-1 text-sm rounded bg-gray-700 hover:bg-gray-600 transition">
        Clear Faults
      </button>
    </div>

    <!-- Right: Connection + Theme -->
    <div class="flex items-center gap-3">
      <span class="flex items-center gap-1 text-sm">
        <span :class="conn.connected ? 'bg-green-500' : 'bg-red-500'" class="w-2 h-2 rounded-full"></span>
        {{ conn.connected ? 'Connected' : 'Disconnected' }}
      </span>
      <button @click="ui.toggleTheme()" class="p-1 rounded hover:bg-gray-700 transition">
        {{ ui.theme === 'dark' ? '☀️' : '🌙' }}
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { useConnectionStore } from '@/stores/connection'
import { useUiStore } from '@/stores/ui'

const conn = useConnectionStore()
const ui = useUiStore()
</script>
```

- [ ] **Step 3: Create AppFooter**

Write `/home/llx/litearm-web/src/components/layout/AppFooter.vue`:

```vue
<template>
  <footer
    class="flex items-center h-8 px-4 bg-gray-800 text-gray-300 text-xs border-t border-gray-700 shrink-0 cursor-pointer"
    @click="ui.logsExpanded = !ui.logsExpanded"
  >
    <span class="mr-4">📋 Logs</span>
    <span class="mr-4">Status: <StatusBadge :state="arm.state" /></span>
    <span class="mr-4">Temp: {{ arm.maxTemp.toFixed(1) }}°C</span>
    <span class="mr-4">Faults: {{ arm.faults.length }}</span>
    <span class="ml-auto">{{ ui.logsExpanded ? '▼' : '▲' }}</span>
  </footer>

  <!-- Expandable log area -->
  <div v-if="ui.logsExpanded" class="h-48 bg-gray-900 text-gray-300 text-xs p-2 overflow-auto border-t border-gray-700">
    <div v-if="system.logs.length === 0" class="text-gray-500">No logs yet</div>
    <div v-for="log in system.logs" :key="log.id" class="py-0.5">
      <span class="text-gray-500">{{ log.timestamp }}</span>
      <span :class="logLevelClass(log.level)" class="ml-2">[{{ log.level }}]</span>
      <span class="ml-2">{{ log.message }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useArmStore } from '@/stores/arm'
import { useSystemStore } from '@/stores/system'
import { useUiStore } from '@/stores/ui'
import StatusBadge from '@/components/common/StatusBadge.vue'

const arm = useArmStore()
const system = useSystemStore()
const ui = useUiStore()

function logLevelClass(level: string) {
  switch (level) {
    case 'ERROR': return 'text-red-400'
    case 'WARNING': return 'text-yellow-400'
    case 'INFO': return 'text-green-400'
    default: return 'text-gray-400'
  }
}
</script>
```

- [ ] **Step 4: Create WorkspaceView with 3-column layout**

Write `/home/llx/litearm-web/src/views/WorkspaceView.vue`:

```vue
<template>
  <div class="flex flex-col h-screen bg-gray-100 dark:bg-gray-950">
    <AppTopbar />

    <div class="flex flex-1 min-h-0 gap-2 p-2">
      <!-- Left Column: 3D Viewport (top) + Joint Status (bottom) -->
      <div class="flex flex-col w-1/4 gap-2 min-w-0">
        <div class="flex-1 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div class="flex items-center justify-center h-full text-gray-400">
            3D Viewport (Phase 2)
          </div>
        </div>
        <div class="h-1/3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3 overflow-auto">
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Joint Status</h3>
          <div class="text-xs text-gray-500">(Phase 2)</div>
        </div>
      </div>

      <!-- Center Column: Joint Control (top) + Cartesian Motion (bottom) -->
      <div class="flex flex-col flex-1 gap-2 min-w-0">
        <div class="flex-1 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3 overflow-auto">
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Joint Control</h3>
          <div class="text-xs text-gray-500">(Phase 2)</div>
        </div>
        <div class="h-1/3 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3 overflow-auto">
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Cartesian Motion</h3>
          <div class="text-xs text-gray-500">(Phase 3)</div>
        </div>
      </div>

      <!-- Right Column: Estop (top) + Trajectory (mid) + End Effector (bottom) -->
      <div class="flex flex-col w-1/4 gap-2 min-w-0">
        <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3 flex items-center justify-center">
          <button class="w-20 h-20 rounded-full bg-red-600 hover:bg-red-700 text-white font-bold text-lg shadow-lg active:scale-95 transition">
            STOP
          </button>
        </div>
        <div class="flex-1 bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3 overflow-auto">
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Trajectory</h3>
          <div class="text-xs text-gray-500">(Phase 4)</div>
        </div>
        <div class="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
          <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">End Effector</h3>
          <div class="text-xs text-gray-500">(Phase 3)</div>
        </div>
      </div>
    </div>

    <AppFooter />
  </div>
</template>

<script setup lang="ts">
import AppTopbar from '@/components/layout/AppTopbar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
</script>
```

- [ ] **Step 5: Create LoginView**

Write `/home/llx/litearm-web/src/views/LoginView.vue`:

```vue
<template>
  <div class="flex items-center justify-center min-h-screen bg-gray-900">
    <div class="w-80 bg-gray-800 rounded-lg p-6 shadow-xl">
      <h1 class="text-2xl font-bold text-white text-center mb-6">LiteArm</h1>

      <div class="space-y-4">
        <div>
          <label class="block text-sm text-gray-400 mb-1">Server</label>
          <input v-model="endpoint" placeholder="192.168.31.237:7449"
            class="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none" />
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">Username</label>
          <input v-model="username" placeholder="admin"
            class="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none" />
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">Password</label>
          <input v-model="password" type="password" placeholder="••••••"
            class="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
            @keyup.enter="login" />
        </div>

        <p v-if="error" class="text-red-400 text-sm">{{ error }}</p>

        <button @click="login" :disabled="loading"
          class="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition disabled:opacity-50">
          {{ loading ? 'Connecting...' : 'Login' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useConnectionStore } from '@/stores/connection'

const router = useRouter()
const conn = useConnectionStore()

const endpoint = ref(import.meta.env.VITE_SERVER_ENDPOINT || '192.168.31.237:7449')
const username = ref('admin')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function login() {
  error.value = ''
  loading.value = true

  try {
    // TODO: Phase 1 server — real JWT login via HTTP POST
    // For now with mock, generate a fake token
    if (import.meta.env.VITE_USE_MOCK === 'true') {
      conn.setToken('mock-jwt-token')
      conn.endpoint = endpoint.value
      conn.status = 'connected'
      router.push('/')
    } else {
      const authUrl = import.meta.env.VITE_AUTH_URL || `http://${endpoint.value}/api/auth`
      const res = await fetch(`${authUrl}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.value, password: password.value }),
      })
      if (!res.ok) throw new Error('Login failed')
      const data = await res.json()
      conn.setToken(data.token)
      conn.endpoint = endpoint.value
      conn.status = 'connected'
      router.push('/')
    }
  } catch (e: any) {
    error.value = e.message || 'Connection failed'
  } finally {
    loading.value = false
  }
}
</script>
```

- [ ] **Step 6: Verify dev server starts**

```bash
cd /home/llx/litearm-web
npx vite --host 2>&1 | head -20
```

Expected: Vite dev server starts, shows URL. Then Ctrl+C to stop.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: three-column workspace layout with topbar, footer, login

WorkspaceView: left (3D+status), center (joint+cartesian), right (estop+traj+device)
AppTopbar: logo, Zero Gravity/Hold/Clear Faults buttons, connection status, theme
AppFooter: expandable logs, status badge, temp, faults
LoginView: endpoint/username/password form, mock token for dev mode
StatusBadge: color-coded arm state indicator"
```

---

### Task 7: useArmState Composable (State Broadcast Subscription)

**Files:**
- Create: `src/composables/useArmState.ts`

- [ ] **Step 1: Create useArmState composable**

Write `/home/llx/litearm-web/src/composables/useArmState.ts`:

```typescript
import { onMounted, onUnmounted } from 'vue'
import { useArmStore } from '@/stores/arm'
import { createArmService } from '@/services/factory'
import type { IArmService } from '@/services/types'

let armService: IArmService | null = null
let unsubscribe: (() => void) | null = null

export function getArmService(): IArmService | null {
  return armService
}

export function useArmState() {
  const arm = useArmStore()

  onMounted(async () => {
    if (!armService) {
      armService = createArmService()
    }
    // Subscribe to state broadcasts
    unsubscribe = armService.onState((snap) => {
      arm.q = snap.q
      arm.dq = snap.dq
      arm.tau = snap.tau
      arm.state = snap.state
      arm.faults = snap.faults
      arm.temps = snap.temps
    })
  })

  onUnmounted(() => {
    if (unsubscribe) { unsubscribe(); unsubscribe = null }
  })

  return { armService }
}
```

- [ ] **Step 2: Wire into WorkspaceView**

Add to `/home/llx/litearm-web/src/views/WorkspaceView.vue` `<script setup>`:

```typescript
import { useArmState } from '@/composables/useArmState'
const { armService } = useArmState()
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: useArmState composable subscribes SDK broadcast → armStore

Singleton armService instance, onState callback updates all armStore fields,
wired into WorkspaceView for automatic state flow"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | Initialize project | package.json, vite.config.ts, tsconfig |
| 2 | Router + App + main | router/index.ts, App.vue, main.ts |
| 3 | Pinia stores | stores/arm.ts, connection.ts, system.ts, motion.ts, ui.ts |
| 4 | Service layer + mock | services/types.ts, mock/arm-mock.ts, factory.ts |
| 5 | Theme system | composables/useTheme.ts |
| 6 | Layout + Login | WorkspaceView, AppTopbar, AppFooter, LoginView |
| 7 | State subscription | composables/useArmState.ts |

**Total**: 7 tasks, ~25 files created. Produces a runnable dev server with mock data flowing through the full stack.
