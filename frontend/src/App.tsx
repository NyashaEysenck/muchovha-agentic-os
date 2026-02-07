import { useState, useRef, useEffect, useCallback } from 'react'
import { useStore } from './store'
import { TerminalPanel } from './components/TerminalPanel'
import { AgentPanel } from './components/AgentPanel'
import { SkillDrawer } from './components/SkillDrawer'
import { SystemBar } from './components/SystemBar'
import { Toasts } from './components/Toasts'
import { Terminal, Sun, Moon, Cpu, Puzzle, PanelRightOpen, PanelRightClose } from 'lucide-react'
import './theme.css'
import './App.css'

export function App() {
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const isAgentPanelOpen = useStore((s) => s.isAgentPanelOpen)
  const toggleAgentPanel = useStore((s) => s.toggleAgentPanel)
  const toggleSkillDrawer = useStore((s) => s.toggleSkillDrawer)
  const connectionStatus = useStore((s) => s.connectionStatus)
  const setSkills = useStore((s) => s.setSkills)
  const setMetrics = useStore((s) => s.setMetrics)

  // Fetch skills on mount
  useEffect(() => {
    fetch('/api/skills').then((r) => r.json()).then((d) => setSkills(d.skills || [])).catch(() => {})
  }, [setSkills])

  // Poll system metrics every 5s
  useEffect(() => {
    const poll = () => fetch('/api/system/metrics').then((r) => r.json()).then((d) => {
      if (!d.error) setMetrics(d)
    }).catch(() => {})
    poll()
    const iv = setInterval(poll, 5000)
    return () => clearInterval(iv)
  }, [setMetrics])

  // ── Resize handle ──────────────────────────────────────────────────
  const [splitPct, setSplitPct] = useState(55)
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!containerRef.current) return
      // Only process moves during drag — check via ref to avoid dep
      setIsDragging((dragging) => {
        if (!dragging) return false
        const rect = containerRef.current!.getBoundingClientRect()
        const pct = ((e.clientX - rect.left) / rect.width) * 100
        setSplitPct(Math.max(25, Math.min(75, pct)))
        return true
      })
    }
    const onUp = () => {
      setIsDragging(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  return (
    <div className="app" data-theme={theme}>
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <div className="header-logo">
            <div className="logo-mark"><Cpu size={15} strokeWidth={2.5} /></div>
            <span className="logo-text">AgentOS</span>
          </div>
          <span className={`connection-dot ${connectionStatus}`} title={connectionStatus} />
        </div>

        <div className="header-center">
          <button className="header-btn" onClick={toggleSkillDrawer} title="Skills">
            <Puzzle size={14} />
            <span>Skills</span>
          </button>
        </div>

        <div className="header-right">
          <button className="header-icon-btn" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button className={`header-icon-btn ${isAgentPanelOpen ? 'active' : ''}`} onClick={toggleAgentPanel} title="Toggle agent panel">
            {isAgentPanelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </button>
        </div>
      </header>

      {/* Main area */}
      <div className="app-main" ref={containerRef}>
        <div className="pane pane-terminal" style={{ width: isAgentPanelOpen ? `${splitPct}%` : '100%' }}>
          <TerminalPanel />
        </div>

        {isAgentPanelOpen && (
          <div className={`resize-handle ${isDragging ? 'dragging' : ''}`} onMouseDown={onMouseDown} />
        )}

        {isAgentPanelOpen && (
          <div className="pane pane-agent" style={{ width: `${100 - splitPct}%` }}>
            <AgentPanel />
          </div>
        )}
      </div>

      {/* System bar */}
      <SystemBar />

      {/* Overlays */}
      <SkillDrawer />
      <Toasts />
    </div>
  )
}
