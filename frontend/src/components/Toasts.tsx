import { useStore } from '../store'
import { Info, CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react'
import './Toasts.css'

const TOAST_ICONS = {
  info: <Info size={15} />,
  success: <CheckCircle2 size={15} />,
  warning: <AlertTriangle size={15} />,
  error: <XCircle size={15} />,
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  const removeToast = useStore((s) => s.removeToast)

  if (toasts.length === 0) return null

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.type}`}
          onClick={() => removeToast(toast.id)}
        >
          <span className="toast-icon">{TOAST_ICONS[toast.type]}</span>
          <span className="toast-message">{toast.message}</span>
          <button className="toast-close" onClick={() => removeToast(toast.id)}>
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
