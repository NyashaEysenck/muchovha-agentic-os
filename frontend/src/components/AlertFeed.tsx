import { useState } from 'react'
import { useStore } from '../store'
import { ShieldCheck, ShieldOff, X, Activity, Loader2, ChevronDown, ChevronRight, Wrench } from 'lucide-react'
import './AlertFeed.css'

export function AlertFeed() {
  const alerts = useStore((s) => s.monitorAlerts)
  const dismissAlert = useStore((s) => s.dismissAlert)
  const autoHealEnabled = useStore((s) => s.autoHealEnabled)
  const toggleAutoHeal = useStore((s) => s.toggleAutoHeal)
  const monitorStatus = useStore((s) => s.monitorStatus)

  return (
    <div className="alert-feed-panel">
      <div className="alert-feed-header">
        <span className="tile-label">Health Monitor</span>
        <div className="alert-feed-controls">
          <span className={`monitor-dot ${monitorStatus}`} />
          <button
            className={`heal-toggle ${autoHealEnabled ? 'active' : ''}`}
            onClick={toggleAutoHeal}
            title={autoHealEnabled ? 'Self-Heal ON' : 'Self-Heal OFF'}
          >
            {autoHealEnabled ? <ShieldCheck size={11} /> : <ShieldOff size={11} />}
            {autoHealEnabled ? 'Auto' : 'Manual'}
          </button>
        </div>
      </div>

      <div className="alert-feed-list">
        {alerts.length === 0 ? (
          <div className="alert-feed-empty">
            <Activity size={18} strokeWidth={1.5} />
            <span>All systems nominal</span>
          </div>
        ) : (
          alerts.map((alert) => (
            <AlertCard key={alert.id} alert={alert} onDismiss={dismissAlert} />
          ))
        )}
      </div>
    </div>
  )
}

function AlertCard({ alert, onDismiss }: { alert: any; onDismiss: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`feed-alert feed-alert-${alert.severity}`}>
      <div className="feed-alert-main">
        <div className={`feed-alert-dot ${alert.severity}`} />
        <div className="feed-alert-body">
          <span className="feed-alert-title">{alert.title}</span>
          <span className="feed-alert-detail">{alert.detail}</span>

          {/* Healing in progress */}
          {alert.healing_in_progress && (
            <span className="feed-alert-healing">
              <Loader2 size={9} className="spin" /> Agent diagnosing...
            </span>
          )}

          {/* Healed with response */}
          {alert.auto_healed && alert.agent_response && (
            <button className="feed-alert-healed-btn" onClick={() => setExpanded(!expanded)}>
              <Wrench size={9} />
              <span>Auto-healed</span>
              {expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
            </button>
          )}

          {/* Just healed, no response yet */}
          {alert.auto_healed && !alert.agent_response && !alert.healing_in_progress && (
            <span className="feed-alert-healed">
              <ShieldCheck size={9} /> Auto-healed
            </span>
          )}
        </div>
        <button className="feed-alert-dismiss" onClick={() => onDismiss(alert.id)}>
          <X size={11} />
        </button>
      </div>

      {/* Expanded agent response */}
      {expanded && alert.agent_response && (
        <div className="feed-alert-response">
          <pre>{alert.agent_response}</pre>
        </div>
      )}
    </div>
  )
}
