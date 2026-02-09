import { useEffect } from 'react'
import { useStore } from './store'
import { TerminalPanel } from './components/TerminalPanel'
import { AgentTimeline } from './components/AgentTimeline'
import { SystemVitals } from './components/SystemVitals'
import { AlertFeed } from './components/AlertFeed'
import { CommandBar } from './components/CommandBar'
import { SkillDrawer } from './components/SkillDrawer'
import { Toasts } from './components/Toasts'
import { Sun, Moon, Cpu, Puzzle, Loader2 } from 'lucide-react'
import './theme.css'
import './App.css'

export function App() {
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const toggleSkillDrawer = useStore((s) => s.toggleSkillDrawer)
  const connectionStatus = useStore((s) => s.connectionStatus)
  const setSkills = useStore((s) => s.setSkills)
  const setMetrics = useStore((s) => s.setMetrics)
  const setThinkingEnabled = useStore((s) => s.setThinkingEnabled)
  const setMonitorState = useStore((s) => s.setMonitorState)
  const isRunning = useStore((s) => s.isAgentRunning)
  const monitorStatus = useStore((s) => s.monitorStatus)

  // Fetch skills + thinking state on mount
  useEffect(() => {
    fetch('/api/skills').then((r) => r.json()).then((d) => setSkills(d.skills || [])).catch(() => {})
    fetch('/api/thinking').then((r) => r.json()).then((d) => setThinkingEnabled(d.enabled)).catch(() => {})
  }, [setSkills, setThinkingEnabled])

  // Poll system metrics every 8s
  useEffect(() => {
    const poll = () => fetch('/api/system/metrics').then((r) => r.json()).then((d) => {
      if (!d.error) setMetrics(d)
    }).catch(() => {})
    poll()
    const iv = setInterval(poll, 8000)
    return () => clearInterval(iv)
  }, [setMetrics])

  // Poll health monitor every 5s
  useEffect(() => {
    const poll = () => fetch('/api/monitor/status').then((r) => r.json()).then((d) => {
      if (!d.error) setMonitorState({ enabled: d.enabled, auto_heal: d.auto_heal, status: d.status, alerts: d.alerts || [] })
    }).catch(() => {})
    poll()
    const iv = setInterval(poll, 5000)
    return () => clearInterval(iv)
  }, [setMonitorState])

  // Dynamic border glow on anomaly
  const glowClass = monitorStatus === 'critical' ? 'glow-danger' : monitorStatus === 'warning' ? 'glow-warn' : ''

  return (
    <div className={`app ${glowClass}`}>
      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="header-left">
          <div className="header-logo">
            <div className="logo-mark"><Cpu size={15} strokeWidth={2.5} /></div>
            <span className="logo-text">MuchovhaOS</span>
          </div>
          <span className={`connection-dot ${connectionStatus}`} title={connectionStatus} />
          {isRunning && <span className="header-running"><Loader2 size={12} className="spin" /> Agent active</span>}
        </div>

        <div className="header-right">
          <button className="header-btn" onClick={toggleSkillDrawer} title="Skills">
            <Puzzle size={14} />
            <span>Skills</span>
          </button>
          <button className="header-icon-btn" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </header>

      {/* ── Dashboard grid ───────────────────────────────────────────── */}
      <div className="dashboard">
        {/* Left: Terminal (main viewport) */}
        <div className="tile tile-terminal">
          <TerminalPanel />
          {/* Agent operating overlay */}
          {isRunning && (
            <div className="terminal-agent-overlay">
              <Loader2 size={14} className="spin" />
              <span>Agent is operating</span>
            </div>
          )}
        </div>

        {/* Right column: stacked panels */}
        <div className="tile-column">
          <div className="tile tile-vitals">
            <SystemVitals />
          </div>
          <div className="tile tile-alerts">
            <AlertFeed />
          </div>
          <div className="tile tile-timeline">
            <AgentTimeline />
          </div>
        </div>
      </div>

      {/* ── Command bar (bottom) ─────────────────────────────────────── */}
      <CommandBar />

      {/* ── Overlays ─────────────────────────────────────────────────── */}
      <SkillDrawer />
      <Toasts />
    </div>
  )
}
