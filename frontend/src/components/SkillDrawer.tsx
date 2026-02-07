import { useStore } from '../store'
import { X, Puzzle, Check, Zap } from 'lucide-react'
import './SkillDrawer.css'

export function SkillDrawer() {
  const isOpen = useStore((s) => s.isSkillDrawerOpen)
  const toggle = useStore((s) => s.toggleSkillDrawer)
  const skills = useStore((s) => s.skills)
  const setSkills = useStore((s) => s.setSkills)
  const addToast = useStore((s) => s.addToast)

  if (!isOpen) return null

  const toggleSkill = async (name: string, active: boolean) => {
    const endpoint = active ? 'deactivate' : 'activate'
    try {
      const res = await fetch(`/api/skills/${name}/${endpoint}`, { method: 'POST' })
      const data = await res.json()
      if (data.error) { addToast({ type: 'error', message: data.error }); return }
      // Use fresh skills from store to avoid stale closure
      const current = useStore.getState().skills
      setSkills(current.map((s) => s.name === name ? { ...s, active: !active } : s))
      addToast({ type: 'success', message: `${name} ${active ? 'deactivated' : 'activated'}`, duration: 2000 })
    } catch (err: any) {
      addToast({ type: 'error', message: err.message })
    }
  }

  return (
    <div className="drawer-overlay" onClick={toggle}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div className="drawer-title">
            <Puzzle size={16} />
            <span>Skills</span>
          </div>
          <button className="drawer-close" onClick={toggle}><X size={16} /></button>
        </div>

        <div className="drawer-body">
          {skills.length === 0 && (
            <div className="drawer-empty">No skills discovered. Add SKILL.md directories to /etc/agentos/skills/ or ~/skills/</div>
          )}
          {skills.map((skill) => (
            <div key={skill.name} className={`skill-card ${skill.active ? 'active' : ''}`}>
              <div className="skill-info">
                <div className="skill-name">
                  {skill.active && <Zap size={12} className="skill-active-icon" />}
                  {skill.name}
                </div>
                <div className="skill-desc">{skill.description}</div>
              </div>
              <button
                className={`skill-toggle ${skill.active ? 'on' : ''}`}
                onClick={() => toggleSkill(skill.name, skill.active)}
              >
                {skill.active ? <Check size={12} /> : 'Activate'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
