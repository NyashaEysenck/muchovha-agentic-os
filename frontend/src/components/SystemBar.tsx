import { useStore } from '../store'
import { Cpu, HardDrive, MemoryStick, Puzzle } from 'lucide-react'
import './SystemBar.css'

export function SystemBar() {
  const metrics = useStore((s) => s.metrics)
  const skills = useStore((s) => s.skills)
  const connectionStatus = useStore((s) => s.connectionStatus)

  const activeSkills = skills.filter((s) => s.active).length

  return (
    <div className="system-bar">
      <div className="system-bar-left">
        {metrics ? (
          <>
            <span className="sys-item" title="CPU usage">
              <Cpu size={11} />
              <span className={metrics.cpu.usage_percent > 80 ? 'warn' : ''}>{metrics.cpu.usage_percent}%</span>
            </span>
            <span className="sys-item" title="Memory">
              <MemoryStick size={11} />
              <span className={metrics.memory.usage_percent > 80 ? 'warn' : ''}>
                {metrics.memory.used_mb}MB / {metrics.memory.total_mb}MB
              </span>
            </span>
            <span className="sys-item" title="Disk">
              <HardDrive size={11} />
              <span>{metrics.disk.used_gb}GB / {metrics.disk.total_gb}GB</span>
            </span>
          </>
        ) : (
          <span className="sys-item muted">System metrics loading...</span>
        )}
      </div>
      <div className="system-bar-right">
        <span className="sys-item">
          <Puzzle size={11} />
          <span>{activeSkills} / {skills.length} skills</span>
        </span>
        <span className="sys-item">
          <span className={`sys-dot ${connectionStatus}`} />
          {connectionStatus}
        </span>
      </div>
    </div>
  )
}
