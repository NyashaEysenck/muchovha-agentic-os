import { create } from 'zustand'

// ── Types ───────────────────────────────────────────────────────────────

export type Theme = 'dark' | 'light'
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export type AgentEventType = 'status' | 'thought' | 'tool_call' | 'tool_result' | 'text' | 'error' | 'done'

export interface AgentEvent {
  id: string
  type: AgentEventType
  data: Record<string, any>
  timestamp: number
}

export interface Skill {
  name: string
  description: string
  path: string
  active: boolean
}

export interface SystemMetrics {
  cpu: { usage_percent: number; cores: number; load: number[] }
  memory: { total_mb: number; used_mb: number; available_mb: number; usage_percent: number }
  disk: { total_gb: number; used_gb: number; available_gb: number; usage_percent: number }
}

export interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
  duration?: number
}

/** A file uploaded for the agent (image, audio, screenshot). */
export interface UploadedAttachment {
  id: string              // server-assigned UUID
  localId: string         // client-side UUID for UI keying
  name: string
  mime_type: string
  size: number
  previewUrl?: string     // data URL for image thumbnails
}

// ── State ───────────────────────────────────────────────────────────────

interface AppState {
  // Theme
  theme: Theme
  toggleTheme: () => void

  // Connection
  connectionStatus: ConnectionStatus
  setConnectionStatus: (s: ConnectionStatus) => void
  sessionId: string
  setSessionId: (id: string) => void

  // Agent
  agentEvents: AgentEvent[]
  addAgentEvent: (e: AgentEvent) => void
  clearAgentEvents: () => void
  isAgentRunning: boolean
  setAgentRunning: (v: boolean) => void
  agentInput: string
  setAgentInput: (s: string) => void

  // Attachments (pending upload for next agent run)
  attachments: UploadedAttachment[]
  addAttachment: (a: UploadedAttachment) => void
  removeAttachment: (localId: string) => void
  clearAttachments: () => void

  // Audio recording
  isRecording: boolean
  setRecording: (v: boolean) => void

  // Thinking mode
  thinkingEnabled: boolean
  setThinkingEnabled: (v: boolean) => void
  toggleThinking: () => Promise<void>

  // Skills
  skills: Skill[]
  setSkills: (s: Skill[]) => void
  isSkillDrawerOpen: boolean
  toggleSkillDrawer: () => void

  // System metrics
  metrics: SystemMetrics | null
  setMetrics: (m: SystemMetrics) => void

  // Terminal
  terminalFontSize: number
  setTerminalFontSize: (n: number) => void

  // Panels
  isAgentPanelOpen: boolean
  toggleAgentPanel: () => void

  // Toasts
  toasts: Toast[]
  addToast: (t: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

let _id = 0
const uid = () => `${Date.now()}-${++_id}`

export const useStore = create<AppState>((set, get) => ({
  // ── Theme ──────────────────────────────────────────────────────────
  theme: 'dark',
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    set({ theme: next })
  },

  // ── Connection ────────────────────────────────────────────────────
  connectionStatus: 'connecting',
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  sessionId: 'default',
  setSessionId: (sessionId) => set({ sessionId }),

  // ── Agent ─────────────────────────────────────────────────────────
  agentEvents: [],
  addAgentEvent: (e) => set((s) => ({ agentEvents: [...s.agentEvents, { ...e, id: e.id || uid() }] })),
  clearAgentEvents: () => set({ agentEvents: [] }),
  isAgentRunning: false,
  setAgentRunning: (isAgentRunning) => set({ isAgentRunning }),
  agentInput: '',
  setAgentInput: (agentInput) => set({ agentInput }),

  // ── Attachments ───────────────────────────────────────────────────
  attachments: [],
  addAttachment: (a) => set((s) => ({ attachments: [...s.attachments, a] })),
  removeAttachment: (localId) => set((s) => ({ attachments: s.attachments.filter((a) => a.localId !== localId) })),
  clearAttachments: () => set({ attachments: [] }),

  // ── Audio recording ───────────────────────────────────────────────
  isRecording: false,
  setRecording: (isRecording) => set({ isRecording }),

  // ── Thinking mode ─────────────────────────────────────────────────
  thinkingEnabled: true,
  setThinkingEnabled: (thinkingEnabled) => set({ thinkingEnabled }),
  toggleThinking: async () => {
    try {
      const res = await fetch('/api/thinking/toggle', { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        set({ thinkingEnabled: data.enabled })
      }
    } catch {}
  },

  // ── Skills ────────────────────────────────────────────────────────
  skills: [],
  setSkills: (skills) => set({ skills }),
  isSkillDrawerOpen: false,
  toggleSkillDrawer: () => set((s) => ({ isSkillDrawerOpen: !s.isSkillDrawerOpen })),

  // ── System metrics ────────────────────────────────────────────────
  metrics: null,
  setMetrics: (metrics) => set({ metrics }),

  // ── Terminal ──────────────────────────────────────────────────────
  terminalFontSize: 14,
  setTerminalFontSize: (terminalFontSize) => set({ terminalFontSize }),

  // ── Panels ────────────────────────────────────────────────────────
  isAgentPanelOpen: true,
  toggleAgentPanel: () => set((s) => ({ isAgentPanelOpen: !s.isAgentPanelOpen })),

  // ── Toasts ────────────────────────────────────────────────────────
  toasts: [],
  addToast: (t) => {
    const toast: Toast = { ...t, id: uid() }
    set((s) => ({ toasts: [...s.toasts, toast] }))
    setTimeout(() => get().removeToast(toast.id), t.duration || 3500)
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
