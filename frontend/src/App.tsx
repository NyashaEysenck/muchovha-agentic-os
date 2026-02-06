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
  const isChatOpen = useStore((s) => s.isChatOpen)
  const toggleChat = useStore((s) => s.toggleChat)
  const togglePalette = useStore((s) => s.togglePalette)

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
  }, [])

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
          style={{ width: isChatOpen ? `${splitPct}%` : '100%' }}
        >
          <TerminalPanel />
        </div>

        {isChatOpen && (
          <div
            className={`resize-handle ${draggingRef.current ? 'dragging' : ''}`}
            onMouseDown={onMouseDown}
          />
        )}

        {isChatOpen && (
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
