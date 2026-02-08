import { useState, useEffect, useRef, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useStore } from '../store'
import { Search, ChevronUp, ChevronDown, X, Minus, Plus, TerminalSquare } from 'lucide-react'
import './TerminalPanel.css'

export function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const fontSize = useStore((s) => s.terminalFontSize)
  const setFontSize = useStore((s) => s.setTerminalFontSize)
  const setConnectionStatus = useStore((s) => s.setConnectionStatus)
  const setSessionId = useStore((s) => s.setSessionId)

  const [isSearchOpen, setSearchOpen] = useState(false)

  const connectWS = useCallback(() => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws/terminal`)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      setConnectionStatus('connected')
      setTimeout(() => {
        fitRef.current?.fit()
        ws.send(JSON.stringify({ type: 'resize', cols: termRef.current?.cols || 80, rows: termRef.current?.rows || 24 }))
      }, 100)
    }

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        termRef.current?.write(new Uint8Array(event.data))
      } else {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'session') setSessionId(msg.id)
        } catch {}
      }
    }

    ws.onclose = () => { setConnectionStatus('disconnected'); setTimeout(connectWS, 2000) }
    ws.onerror = () => setConnectionStatus('error')
  }, [setConnectionStatus, setSessionId])

  useEffect(() => {
    if (!containerRef.current || termRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      fontSize,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', monospace",
      lineHeight: 1.35,
      letterSpacing: 0.3,
      theme: {
        background: '#111113', foreground: '#d4d4d8', cursor: '#2dd4bf',
        selectionBackground: 'rgba(45,212,191,0.18)',
        black: '#52525b', red: '#f87171', green: '#34d399', yellow: '#fbbf24',
        blue: '#60a5fa', magenta: '#c084fc', cyan: '#2dd4bf', white: '#d4d4d8',
        brightBlack: '#71717a', brightRed: '#fca5a5', brightGreen: '#6ee7b7',
        brightYellow: '#fde68a', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe',
        brightCyan: '#5eead4', brightWhite: '#fafafa',
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
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode(data))
    })

    const ro = new ResizeObserver(() => {
      fitAddon.fit()
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    })
    ro.observe(containerRef.current)

    // Expose terminal context for the agent panel
    ;(window as any).__getTerminalContext = () => {
      const buffer = term.buffer.active
      const lines: string[] = []
      const start = Math.max(0, buffer.length - 50)
      for (let i = start; i < buffer.length; i++) {
        const line = buffer.getLine(i)
        if (line) { const text = line.translateToString(true); if (text.trim()) lines.push(text) }
      }
      return lines.join('\n')
    }

    ;(window as any).__runInTerminal = (cmd: string) => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(new TextEncoder().encode(cmd + '\n'))
    }

    connectWS()
    return () => { ro.disconnect(); term.dispose(); wsRef.current?.close() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectWS])

  useEffect(() => {
    if (termRef.current) { termRef.current.options.fontSize = fontSize; fitRef.current?.fit() }
  }, [fontSize])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'F') { e.preventDefault(); setSearchOpen((v: boolean) => !v) }
      if (e.ctrlKey && e.key === '=') { e.preventDefault(); setFontSize(Math.min(fontSize + 1, 28)) }
      if (e.ctrlKey && e.key === '-') { e.preventDefault(); setFontSize(Math.max(fontSize - 1, 9)) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [fontSize, setFontSize])

  useEffect(() => { if (isSearchOpen) searchInputRef.current?.focus() }, [isSearchOpen])

  return (
    <div className="terminal-panel">
      <div className="terminal-toolbar">
        <div className="terminal-toolbar-left">
          <TerminalSquare size={13} className="toolbar-icon" />
          <span className="toolbar-label">Terminal</span>
          <span className="toolbar-chip">bash</span>
        </div>
        <div className="terminal-toolbar-right">
          <button className="toolbar-btn" title="Decrease font" onClick={() => setFontSize(Math.max(fontSize - 1, 9))}>
            <Minus size={12} />
          </button>
          <span className="toolbar-font-size">{fontSize}px</span>
          <button className="toolbar-btn" title="Increase font" onClick={() => setFontSize(Math.min(fontSize + 1, 28))}>
            <Plus size={12} />
          </button>
          <div className="toolbar-divider" />
          <button className="toolbar-btn" title="Search (Ctrl+Shift+F)" onClick={() => setSearchOpen((v: boolean) => !v)}>
            <Search size={13} />
          </button>
        </div>
      </div>

      {isSearchOpen && (
        <div className="terminal-search-bar">
          <Search size={13} />
          <input ref={searchInputRef} type="text" placeholder="Search..." onChange={(e) => {
            if (e.target.value) searchRef.current?.findNext(e.target.value)
            else searchRef.current?.clearDecorations()
          }} onKeyDown={(e) => {
            if (e.key === 'Enter') searchRef.current?.findNext(searchInputRef.current?.value || '')
            if (e.key === 'Escape') { setSearchOpen(false); searchRef.current?.clearDecorations() }
          }} />
          <button onClick={() => searchRef.current?.findNext(searchInputRef.current?.value || '')}><ChevronDown size={14} /></button>
          <button onClick={() => searchRef.current?.findPrevious(searchInputRef.current?.value || '')}><ChevronUp size={14} /></button>
          <button onClick={() => { setSearchOpen(false); searchRef.current?.clearDecorations() }}><X size={14} /></button>
        </div>
      )}

      <div className="terminal-xterm" ref={containerRef} />
    </div>
  )
}

