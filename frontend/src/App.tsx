import { useState, useRef, useEffect, useCallback } from 'react'
import { useStore } from './store'
import { TerminalPanel } from './components/TerminalPanel'
import { ChatPanel } from './components/ChatPanel'
import { CommandPalette } from './components/CommandPalette'
import { Toasts } from './components/Toasts'
import { StatusChip } from './components/StatusChip'
import { Terminal, Sun, Moon, Sparkles, Command } from 'lucide-react'
import './App.css'

export function App() {
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const assistantMode = useStore((s) => s.assistantMode)
  const setAssistantMode = useStore((s) => s.setAssistantMode)
  const isChatOpen = useStore((s) => s.isChatOpen)
  const toggleChat = useStore((s) => s.toggleChat)
  const togglePalette = useStore((s) => s.togglePalette)

  const isShellmate = assistantMode === 'terminal'

  // Auto-close chat panel when entering shellmate mode, restore when leaving
  const prevModeRef = useRef(assistantMode)
  const chatWasOpenRef = useRef(isChatOpen)
  useEffect(() => {
    if (assistantMode === 'terminal' && prevModeRef.current !== 'terminal') {
      chatWasOpenRef.current = isChatOpen
      if (isChatOpen) toggleChat()
    } else if (assistantMode !== 'terminal' && prevModeRef.current === 'terminal') {
      if (chatWasOpenRef.current && !isChatOpen) toggleChat()
    }
    prevModeRef.current = assistantMode
  }, [assistantMode])

  const extractCommands = (text: string): string[] => {
    const blocks = [...text.matchAll(/```(?:bash|sh|shell)?\n([\s\S]*?)```/g)]
    const cmds: string[] = []
    for (const match of blocks) {
      const body = (match[1] || '').trim()
      if (!body) continue
      const lines = body.split('\n').map((l) => l.replace(/^\$\s?/, '').trim())
      for (const line of lines) {
        if (!line) continue
        if (line.startsWith('#') || line.startsWith('//')) continue
        cmds.push(line)
      }
    }
    return cmds
  }

  const runCommands = (commands: string[]) => {
    const runInTerminal = (window as any).__runInTerminal
    if (!runInTerminal || commands.length === 0) return
    commands.forEach((cmd, idx) => {
      setTimeout(() => runInTerminal(cmd), idx * 200)
    })
  }

  const echoAiToTerminal = (text: string) => {
    const runInTerminal = (window as any).__runInTerminal
    if (!runInTerminal) return
    const lines = text.split('\n').slice(0, 30)
    const escaped = lines.map((l) => `AI> ${l}`.replace(/\\/g, '\\\\').replace(/'/g, "'\\''"))
    const cmd = `printf '%s\\n' '${escaped.join("' '")}'`
    runInTerminal(cmd)
  }

  // ── Resize handle ────────────────────────────────────────────────────
  const [splitPct, setSplitPct] = useState(60)
  const draggingRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setSplitPct(Math.max(25, Math.min(80, pct)))
    }
    const onUp = () => {
      draggingRef.current = false
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  // ── Palette action handler ───────────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail as string
      const store = useStore.getState()
      if (!store.isChatOpen) store.toggleChat()

      const userMsg = {
        id: `user-${Date.now()}`,
        role: 'user' as const,
        text: msg,
        timestamp: Date.now(),
      }
      store.addChatMessage(userMsg)

      const aiId = `ai-${Date.now()}`
      store.addChatMessage({
        id: aiId,
        role: 'ai',
        text: '',
        timestamp: Date.now(),
        streaming: true,
      })
      store.setAiThinking(true)

      const context = (window as any).__getTerminalContext?.() || ''
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          terminal_context: context,
          session_id: store.sessionId,
          mode: assistantMode,
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.error) {
            store.updateChatMessage(aiId, { text: 'Error: ' + data.error, streaming: false })
          } else {
            const fullText = data.response
            let i = 0
            const interval = setInterval(() => {
              i += 8
              if (i >= fullText.length) {
                store.updateChatMessage(aiId, { text: fullText, streaming: false })
                if (assistantMode === 'autopilot') {
                  const commands = extractCommands(fullText)
                  if (commands.length) {
                    store.addToast({ type: 'info', message: `Autopilot running ${commands.length} command(s)` })
                    runCommands(commands)
                  }
                }
                // Shellmate mode is handled in TerminalPanel — no palette action needed
                clearInterval(interval)
              } else {
                store.updateChatMessage(aiId, { text: fullText.slice(0, i) })
              }
            }, 12)
          }
        })
        .catch((err) => {
          store.updateChatMessage(aiId, { text: 'Error: ' + err.message, streaming: false })
        })
        .finally(() => store.setAiThinking(false))
    }
    window.addEventListener('palette-action', handler)
    return () => window.removeEventListener('palette-action', handler)
  }, [assistantMode])

  return (
    <div className="app" data-theme={theme}>
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="header-logo">
            <div className="logo-mark">
              <Terminal size={16} strokeWidth={2.5} />
            </div>
            <span className="logo-text">LinuxMentor</span>
          </div>
        </div>

        <div className="header-center">
          <button className="header-palette-btn" onClick={togglePalette}>
            <Command size={13} className="palette-btn-icon" />
            <span className="palette-btn-text">Command palette</span>
            <kbd className="palette-btn-kbd">Ctrl+K</kbd>
          </button>

          <div className="mode-switch" role="group" aria-label="Assistant mode">
            <button
              className={`mode-chip ${assistantMode === 'guided' ? 'active' : ''}`}
              onClick={() => setAssistantMode('guided')}
              title="Guide mode — AI suggests, you run"
            >
              Tutor
            </button>
            <button
              className={`mode-chip ${assistantMode === 'autopilot' ? 'active' : ''}`}
              onClick={() => setAssistantMode('autopilot')}
              title="Autopilot — AI runs commands it proposes"
            >
              Autopilot
            </button>
            <button
              className={`mode-chip ${assistantMode === 'terminal' ? 'active' : ''}`}
              onClick={() => setAssistantMode('terminal')}
              title="Shellmate — AI replies inside the terminal"
            >
              Shellmate
            </button>
          </div>
        </div>

        <div className="header-right">
          <StatusChip />
          <button
            className="header-icon-btn"
            onClick={toggleTheme}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            className={`header-icon-btn ${isChatOpen ? 'active' : ''}`}
            onClick={toggleChat}
            title="Toggle AI panel"
          >
            <Sparkles size={15} />
          </button>
        </div>
      </header>

      {/* Main area */}
      <div className="app-main" ref={containerRef}>
        <div
          className="pane pane-terminal"
          style={{ width: (isChatOpen && !isShellmate) ? `${splitPct}%` : '100%' }}
        >
          <TerminalPanel />
        </div>

        {isChatOpen && !isShellmate && (
          <div
            className={`resize-handle ${draggingRef.current ? 'dragging' : ''}`}
            onMouseDown={onMouseDown}
          />
        )}

        {isChatOpen && !isShellmate && (
          <div
            className="pane pane-chat"
            style={{ width: `${100 - splitPct}%` }}
          >
            <ChatPanel />
          </div>
        )}
      </div>

      <CommandPalette />
      <Toasts />
    </div>
  )
}
