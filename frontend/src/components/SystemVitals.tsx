import { useStore } from '../store'
import './SystemVitals.css'

/** SVG arc gauge — draws a circular arc from 0–100%. */
function ArcGauge({ value, max, label, unit, color, size = 90 }: {
  value: number; max: number; label: string; unit: string; color: string; size?: number
}) {
  const pct = Math.min(value / max * 100, 100)
  const r = (size - 10) / 2
  const cx = size / 2, cy = size / 2
  const circumference = 2 * Math.PI * r * 0.75 // 270° arc
  const offset = circumference - (pct / 100) * circumference
  const startAngle = 135

  return (
    <div className="arc-gauge">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background arc */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none" stroke="var(--surface-3)" strokeWidth={5}
          strokeDasharray={`${circumference} ${2 * Math.PI * r - circumference}`}
          strokeDashoffset={0}
          strokeLinecap="round"
          transform={`rotate(${startAngle} ${cx} ${cy})`}
        />
        {/* Value arc */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none" stroke={color} strokeWidth={5}
          strokeDasharray={`${circumference} ${2 * Math.PI * r - circumference}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(${startAngle} ${cx} ${cy})`}
          className="arc-value"
        />
      </svg>
      <div className="arc-label">
        <span className="arc-number" style={{ color }}>{Math.round(value)}</span>
        <span className="arc-unit">{unit}</span>
      </div>
      <span className="arc-title">{label}</span>
    </div>
  )
}

export function SystemVitals() {
  const metrics = useStore((s) => s.metrics)

  if (!metrics) {
    return (
      <div className="vitals-panel">
        <div className="vitals-header">
          <span className="tile-label">System Vitals</span>
        </div>
        <div className="vitals-loading">Connecting...</div>
      </div>
    )
  }

  const cpuColor = metrics.cpu.usage_percent > 80 ? '#ef4444' : metrics.cpu.usage_percent > 50 ? '#f59e0b' : '#2dd4bf'
  const memColor = metrics.memory.usage_percent > 80 ? '#ef4444' : metrics.memory.usage_percent > 50 ? '#f59e0b' : '#60a5fa'
  const diskColor = metrics.disk.usage_percent > 85 ? '#ef4444' : metrics.disk.usage_percent > 60 ? '#f59e0b' : '#a78bfa'

  return (
    <div className="vitals-panel">
      <div className="vitals-header">
        <span className="tile-label">System Vitals</span>
        <span className="vitals-cores">{metrics.cpu.cores} cores</span>
      </div>
      <div className="vitals-gauges">
        <ArcGauge value={metrics.cpu.usage_percent} max={100} label="CPU" unit="%" color={cpuColor} />
        <ArcGauge value={metrics.memory.usage_percent} max={100} label="Memory" unit="%" color={memColor} />
        <ArcGauge value={metrics.disk.usage_percent} max={100} label="Disk" unit="%" color={diskColor} />
      </div>
      <div className="vitals-details">
        <div className="vitals-row">
          <span className="vitals-key">Load</span>
          <span className="vitals-val">{metrics.cpu.load.map(l => l.toFixed(1)).join(' / ')}</span>
        </div>
        <div className="vitals-row">
          <span className="vitals-key">RAM</span>
          <span className="vitals-val">{metrics.memory.used_mb}MB / {metrics.memory.total_mb}MB</span>
        </div>
        <div className="vitals-row">
          <span className="vitals-key">Disk</span>
          <span className="vitals-val">{metrics.disk.used_gb}GB / {metrics.disk.total_gb}GB</span>
        </div>
      </div>
    </div>
  )
}
