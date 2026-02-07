import { useStore } from '../store'
import { X, Info, CheckCircle, AlertTriangle, AlertCircle } from 'lucide-react'
import './Toasts.css'

const icons = {
  info: <Info size={14} />,
  success: <CheckCircle size={14} />,
  warning: <AlertTriangle size={14} />,
  error: <AlertCircle size={14} />,
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const removeToast = useStore((s) => s.removeToast)

  if (!toasts.length) return null

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-icon">{icons[t.type]}</span>
          <span className="toast-msg">{t.message}</span>
          <button className="toast-close" onClick={() => removeToast(t.id)}><X size={12} /></button>
        </div>
      ))}
    </div>
  )
}
