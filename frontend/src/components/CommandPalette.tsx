import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store'
import { Search, Lightbulb, Wrench, Target, Sun, Moon, MessageSquare, Type, Command } from 'lucide-react'
import './CommandPalette.css'

interface PaletteCommand {
  id: string
  icon: React.ReactNode
  label: string
  hint?: string
  action: () => void
}

export function CommandPalette() {
  const isOpen = useStore((s) => s.isPaletteOpen)
  const togglePalette = useStore((s) => s.togglePalette)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const theme = useStore((s) => s.theme)
  const toggleChat = useStore((s) => s.toggleChat)
  const toggleSearch = useStore((s) => s.toggleSearch)
  const toggleLigatures = useStore((s) => s.toggleLigatures)
  const addMessage = useStore((s) => s.addChatMessage)

  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [isOpen])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        togglePalette()
      }
      if (e.key === 'Escape' && isOpen) {
        togglePalette()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, togglePalette])

  const commands: PaletteCommand[] = [
    {
      id: 'explain',
      icon: <Lightbulb size={16} />,
      label: 'Explain terminal output',
      hint: 'AI analyzes what just happened',
      action: () => {
        addMessage({
          id: `user-${Date.now()}`,
          role: 'user',
          text: 'Explain what just happened in my terminal',
          timestamp: Date.now(),
        })
        window.dispatchEvent(new CustomEvent('palette-action', { detail: 'Explain what just happened in my terminal' }))
      },
    },
    {
      id: 'fix',
      icon: <Wrench size={16} />,
      label: 'Fix last error',
      hint: 'AI diagnoses and suggests fix',
      action: () => {
        window.dispatchEvent(new CustomEvent('palette-action', { detail: 'I got an error. What went wrong and how do I fix it?' }))
      },
    },
    {
      id: 'suggest',
      icon: <Target size={16} />,
      label: 'Suggest next command',
      hint: 'Based on what you\'re doing',
      action: () => {
        window.dispatchEvent(new CustomEvent('palette-action', { detail: 'Based on my terminal history, suggest what I should do next and why.' }))
      },
    },
    {
      id: 'theme',
      icon: theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />,
      label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
      action: toggleTheme,
    },
    {
      id: 'chat',
      icon: <MessageSquare size={16} />,
      label: 'Toggle AI panel',
      action: toggleChat,
    },
    {
      id: 'search',
      icon: <Search size={16} />,
      label: 'Search terminal scrollback',
      hint: 'Ctrl+Shift+F',
      action: toggleSearch,
    },
    {
      id: 'ligatures',
      icon: <Type size={16} />,
      label: 'Toggle font ligatures',
      action: toggleLigatures,
    },
  ]

  const filtered = query
    ? commands.filter((c) =>
        c.label.toLowerCase().includes(query.toLowerCase())
      )
    : commands

  const [selected, setSelected] = useState(0)
  useEffect(() => setSelected(0), [query])

  const executeCommand = (cmd: PaletteCommand) => {
    cmd.action()
    togglePalette()
  }

  if (!isOpen) return null

  return (
    <div className="palette-overlay" onClick={togglePalette}>
      <div className="palette-container" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-wrapper">
          <Command size={14} className="palette-input-icon" />
          <input
            ref={inputRef}
            className="palette-input"
            type="text"
            placeholder="Type a command..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setSelected((s) => Math.min(s + 1, filtered.length - 1))
              if (e.key === 'ArrowUp') setSelected((s) => Math.max(s - 1, 0))
              if (e.key === 'Enter' && filtered[selected]) executeCommand(filtered[selected])
              if (e.key === 'Escape') togglePalette()
            }}
          />
        </div>

        <div className="palette-list">
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`palette-item ${i === selected ? 'selected' : ''}`}
              onClick={() => executeCommand(cmd)}
              onMouseEnter={() => setSelected(i)}
            >
              <span className="palette-item-icon">{cmd.icon}</span>
              <div className="palette-item-content">
                <span className="palette-item-label">{cmd.label}</span>
                {cmd.hint && <span className="palette-item-hint">{cmd.hint}</span>}
              </div>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="palette-empty">No matching commands</div>
          )}
        </div>

        <div className="palette-footer">
          <span><kbd>&uarr;&darr;</kbd> navigate</span>
          <span><kbd>&crarr;</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
