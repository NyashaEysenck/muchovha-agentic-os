import { useStore } from '../store'
import './StatusChip.css'

export function StatusChip() {
  const status = useStore((s) => s.connectionStatus)

  const labels = {
    connecting: 'Connecting...',
    connected: 'Connected',
    disconnected: 'Reconnecting...',
    error: 'Connection lost',
  }

  const dotClass = {
    connecting: 'dot-warning',
    connected: 'dot-success',
    disconnected: 'dot-warning',
    error: 'dot-danger',
  }

  return (
    <div className={`status-chip status-${status}`}>
      <div className={`status-dot ${dotClass[status]}`} />
      <span className="status-label">{labels[status]}</span>
    </div>
  )
}
