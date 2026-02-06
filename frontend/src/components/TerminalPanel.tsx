import { useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useStore } from '../store'
import { Search, ChevronUp, ChevronDown, X, Minus, Plus, TerminalSquare } from 'lucide-react'
import './TerminalPanel.css'

const ERROR_PATTERNS = [
  'command not found', 'no such file or directory', 'permission denied',
  'segmentation fault', 'syntax error', 'cannot access', 'fatal:',
  'error:', 'failed', 'not recognized',
]

export function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const fontSize = useStore((s) => s.terminalFontSize)
  const setFontSize = useStore((s) => s.setTerminalFontSize)
  const ligaturesEnabled = useStore((s) => s.ligaturesEnabled)
  const setConnectionStatus = useStore((s) => s.setConnectionStatus)
  const setSessionId = useStore((s) => s.setSessionId)
  const addToast = useStore((s) => s.addToast)
  const isSearchOpen = useStore((s) => s.isSearchOpen)
  const toggleSearch = useStore((s) => s.toggleSearch)
  const ghostSuggestion = useStore((s) => s.ghostSuggestion)

  const lastErrorRef = useRef(0)

  const connectWS = useCallback(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws/terminal`)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      setConnectionStatus('connected')
      setTimeout(() => {
        fitRef.current?.fit()
        ws.send(JSON.stringify({
          type: 'resize',
          cols: termRef.current?.cols || 80,
          rows: termRef.current?.rows || 24,
        }))
      }, 100)
    }

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data)
        termRef.current?.write(bytes)
        const text = new TextDecoder().decode(event.data)
        const now = Date.now()
        if (now - lastErrorRef.current > 5000) {
          const lower = text.toLowerCase()
          for (const pattern of ERROR_PATTERNS) {
            if (lower.includes(pattern)) {
              lastErrorRef.current = now
              addToast({
                type: 'warning',
                message: 'Error detected \u2014 ask AI for help (Ctrl+K)',
                duration: 5000,
              })
              break
            }
          }
        }
      } else {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'session') setSessionId(msg.id)
        } catch {}
      }
    }

    ws.onclose = () => {
      setConnectionStatus('disconnected')
      setTimeout(connectWS, 2000)
    }
    ws.onerror = () => setConnectionStatus('error')
  }, [setConnectionStatus, setSessionId, addToast])

  useEffect(() => {
    if (!containerRef.current || termRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      fontSize,
      fontFamily: ligaturesEnabled
        ? "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', monospace"
        : "'SF Mono', 'Consolas', 'Liberation Mono', monospace",
      lineHeight: 1.35,
      letterSpacing: 0.3,
      theme: {
        background: getComputedStyle(document.documentElement).getPropertyValue('--term-bg').trim() || '#0a0e14',
        foreground: getComputedStyle(document.documentElement).getPropertyValue('--term-fg').trim() || '#e2e8f0',
        cursor: '#638cff',
        selectionBackground: 'rgba(99,140,255,0.2)',
        selectionForeground: undefined,
        black: '#484f58', red: '#f87171',
        green: '#34d399', yellow: '#fbbf24',
        blue: '#638cff', magenta: '#c084fc',
        cyan: '#22d3ee', white: '#b1bac4',
        brightBlack: '#6e7681', brightRed: '#fca5a5',
        brightGreen: '#6ee7b7', brightYellow: '#fde68a',
        brightBlue: '#93b4ff', brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9', brightWhite: '#f0f6fc',
      },
      allowProposedApi: true,
      scrollback: 5000,
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    term.loadAddon(webLinksAddon)

    termRef.current = term
    fitRef.current = fitAddon
    searchRef.current = searchAddon

    term.open(containerRef.current)
    fitAddon.fit()

    term.onData((data) => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(new TextEncoder().encode(data))
      }
    })

    const ro = new ResizeObserver(() => {
      fitAddon.fit()
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    })
    ro.observe(containerRef.current)

    connectWS()

    return () => {
      ro.disconnect()
      term.dispose()
      wsRef.current?.close()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.fontSize = fontSize
      fitRef.current?.fit()
    }
  }, [fontSize])

  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.fontFamily = ligaturesEnabled
        ? "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', monospace"
        : "'SF Mono', 'Consolas', 'Liberation Mono', monospace"
      fitRef.current?.fit()
    }
  }, [ligaturesEnabled])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') {
        e.preventDefault()
        toggleSearch()
      }
      if (e.ctrlKey && e.key === '=') {
        e.preventDefault()
        setFontSize(Math.min(fontSize + 1, 28))
      }
      if (e.ctrlKey && e.key === '-') {
        e.preventDefault()
        setFontSize(Math.max(fontSize - 1, 9))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fontSize, setFontSize, toggleSearch])

  const searchInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (isSearchOpen) searchInputRef.current?.focus()
  }, [isSearchOpen])

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value
    if (q) searchRef.current?.findNext(q)
    else searchRef.current?.clearDecorations()
  }

  useEffect(() => {
    (window as any).__getTerminalContext = () => {
      const term = termRef.current
      if (!term) return ''
      const buffer = term.buffer.active
      const lines: string[] = []
      const start = Math.max(0, buffer.length - 50)
      for (let i = start; i < buffer.length; i++) {
        const line = buffer.getLine(i)
        if (line) {
          const text = line.translateToString(true)
          if (text.trim()) lines.push(text)
        }
      }
      return lines.join('\n')
    }

    // Expose function to run commands in the terminal from other components
    (window as any).__runInTerminal = (cmd: string) => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        // Send the command text + newline to execute it
        const data = new TextEncoder().encode(cmd + '\n')
        ws.send(data)
      }
    }
  }, [])

  return (
    <div className="terminal-panel">
      {/* Toolbar */}
      <div className="terminal-toolbar">
        <div className="terminal-toolbar-left">
          <span className="toolbar-label">
            <TerminalSquare size={13} className="toolbar-icon" />
            Terminal
          </span>
          <span className="toolbar-chip">bash</span>
        </div>
        <div className="terminal-toolbar-right">
          <button
            className="toolbar-btn"
            title="Decrease font (Ctrl+-)"
            onClick={() => setFontSize(Math.max(fontSize - 1, 9))}
          >
            <Minus size={12} />
          </button>
          <span className="toolbar-font-size">{fontSize}px</span>
          <button
            className="toolbar-btn"
            title="Increase font (Ctrl+=)"
            onClick={() => setFontSize(Math.min(fontSize + 1, 28))}
          >
            <Plus size={12} />
          </button>
          <div className="toolbar-divider" />
          <button
            className="toolbar-btn"
            title="Search scrollback (Ctrl+Shift+F)"
            onClick={toggleSearch}
          >
            <Search size={13} />
          </button>
        </div>
      </div>

      {/* Search overlay */}
      {isSearchOpen && (
        <div className="terminal-search-bar">
          <Search size={13} className="search-bar-icon" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Search terminal output..."
            onChange={handleSearch}
            onKeyDown={(e) => {
              if (e.key === 'Enter') searchRef.current?.findNext(searchInputRef.current?.value || '')
              if (e.key === 'Escape') { toggleSearch(); searchRef.current?.clearDecorations() }
            }}
          />
          <button onClick={() => searchRef.current?.findNext(searchInputRef.current?.value || '')} title="Next">
            <ChevronDown size={14} />
          </button>
          <button onClick={() => searchRef.current?.findPrevious(searchInputRef.current?.value || '')} title="Previous">
            <ChevronUp size={14} />
          </button>
          <button onClick={() => { toggleSearch(); searchRef.current?.clearDecorations() }} title="Close">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Ghost suggestion overlay */}
      {ghostSuggestion && (
        <div className="ghost-suggestion">
          <span className="ghost-text">{ghostSuggestion.text}</span>
          <span className="ghost-hint">Tab to accept</span>
        </div>
      )}

      {/* Terminal */}
      <div className="terminal-xterm" ref={containerRef} />
    </div>
  )
}
