import { create } from 'zustand'

/* ══════════════════════════════════════════════════════════════════════════
   Global application state (Zustand)
   ══════════════════════════════════════════════════════════════════════════ */

export type Theme = 'dark' | 'light'
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error'
export type AssistantMode = 'guided' | 'autopilot' | 'terminal'

export interface TerminalEvent {
  id: string
  command: string
  output: string
  timestamp: number
  hasError: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'ai' | 'system'
  text: string
  timestamp: number
  // If linked to a terminal event
  terminalEventId?: string
  // Action cards embedded in the message
  actions?: ActionCard[]
  // Is it streaming?
  streaming?: boolean
}

export interface ActionCard {
  label: string
  icon: string
  type: 'run' | 'explain' | 'fix' | 'copy'
  payload: string
}

export interface Toast {
  id: string
  message: string
  type: 'info' | 'success' | 'warning' | 'error'
  duration?: number
}

export interface GhostSuggestion {
  text: string
  confidence: number
}

interface AppState {
  // Theme
  theme: Theme
  toggleTheme: () => void

  // Assistant mode
  assistantMode: AssistantMode
  setAssistantMode: (m: AssistantMode) => void

  // Connection
  connectionStatus: ConnectionStatus
  setConnectionStatus: (s: ConnectionStatus) => void
  sessionId: string
  setSessionId: (id: string) => void

  // Terminal
  terminalEvents: TerminalEvent[]
  addTerminalEvent: (e: TerminalEvent) => void
  pinnedOutputs: string[]
  pinOutput: (id: string) => void
  unpinOutput: (id: string) => void
  ghostSuggestion: GhostSuggestion | null
  setGhostSuggestion: (s: GhostSuggestion | null) => void
  terminalFontSize: number
  setTerminalFontSize: (n: number) => void
  ligaturesEnabled: boolean
  toggleLigatures: () => void

  // Chat / AI
  chatMessages: ChatMessage[]
  addChatMessage: (m: ChatMessage) => void
  updateChatMessage: (id: string, partial: Partial<ChatMessage>) => void
  isChatOpen: boolean
  toggleChat: () => void
  isAiThinking: boolean
  setAiThinking: (v: boolean) => void

  // Command palette
  isPaletteOpen: boolean
  togglePalette: () => void

  // Search
  isSearchOpen: boolean
  toggleSearch: () => void

  // Shellmate in-terminal
  shellmateInput: string
  setShellmateInput: (s: string) => void
  isShellmateThinking: boolean
  setShellmateThinking: (v: boolean) => void

  // Toasts
  toasts: Toast[]
  addToast: (t: Omit<Toast, 'id'>) => void
  removeToast: (id: string) => void
}

let _id = 0
const uid = () => `${Date.now()}-${++_id}`

export const useStore = create<AppState>((set, get) => ({
  // ── Theme ──────────────────────────────────────────────────────────────
  theme: 'dark',
  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    set({ theme: next })
  },

  // ── Assistant Mode ─────────────────────────────────────────────────────
  assistantMode: 'guided',
  setAssistantMode: (assistantMode) => set({ assistantMode }),

  // ── Connection ─────────────────────────────────────────────────────────
  connectionStatus: 'connecting',
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  sessionId: 'default',
  setSessionId: (sessionId) => set({ sessionId }),

  // ── Terminal ───────────────────────────────────────────────────────────
  terminalEvents: [],
  addTerminalEvent: (e) =>
    set((s) => ({
      terminalEvents: [...s.terminalEvents.slice(-100), e],
    })),
  pinnedOutputs: [],
  pinOutput: (id) =>
    set((s) => ({
      pinnedOutputs: s.pinnedOutputs.includes(id)
        ? s.pinnedOutputs
        : [...s.pinnedOutputs, id],
    })),
  unpinOutput: (id) =>
    set((s) => ({
      pinnedOutputs: s.pinnedOutputs.filter((p) => p !== id),
    })),
  ghostSuggestion: null,
  setGhostSuggestion: (ghostSuggestion) => set({ ghostSuggestion }),
  terminalFontSize: 14,
  setTerminalFontSize: (terminalFontSize) => set({ terminalFontSize }),
  ligaturesEnabled: true,
  toggleLigatures: () => set((s) => ({ ligaturesEnabled: !s.ligaturesEnabled })),

  // ── Chat ───────────────────────────────────────────────────────────────
  chatMessages: [
    {
      id: uid(),
      role: 'system',
      text: "Welcome to **LinuxMentor**. Run commands in the terminal \u2014 I'll help you learn along the way.\n\nPress `Ctrl+K` to open the command palette, or use the AI panel toggle in the header.",
      timestamp: Date.now(),
    },
  ],
  addChatMessage: (m) =>
    set((s) => ({ chatMessages: [...s.chatMessages, { ...m, id: m.id || uid() }] })),
  updateChatMessage: (id, partial) =>
    set((s) => ({
      chatMessages: s.chatMessages.map((m) =>
        m.id === id ? { ...m, ...partial } : m
      ),
    })),
  isChatOpen: true,
  toggleChat: () => set((s) => ({ isChatOpen: !s.isChatOpen })),
  isAiThinking: false,
  setAiThinking: (isAiThinking) => set({ isAiThinking }),

  // ── Command palette ────────────────────────────────────────────────────
  isPaletteOpen: false,
  togglePalette: () => set((s) => ({ isPaletteOpen: !s.isPaletteOpen })),

  // ── Search ─────────────────────────────────────────────────────────────
  isSearchOpen: false,
  toggleSearch: () => set((s) => ({ isSearchOpen: !s.isSearchOpen })),

  // ── Shellmate ──────────────────────────────────────────────────────────
  shellmateInput: '',
  setShellmateInput: (shellmateInput) => set({ shellmateInput }),
  isShellmateThinking: false,
  setShellmateThinking: (isShellmateThinking) => set({ isShellmateThinking }),

  // ── Toasts ─────────────────────────────────────────────────────────────
  toasts: [],
  addToast: (t) => {
    const toast: Toast = { ...t, id: uid() }
    set((s) => ({ toasts: [...s.toasts, toast] }))
    setTimeout(() => get().removeToast(toast.id), t.duration || 3500)
  },
  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
