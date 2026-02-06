import { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useStore } from '../store'
import { Search, ChevronUp, ChevronDown, X, Minus, Plus, TerminalSquare, Sparkles, Send, Loader2 } from 'lucide-react'
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
  const sessionId = useStore((s) => s.sessionId)
  const addToast = useStore((s) => s.addToast)
  const isSearchOpen = useStore((s) => s.isSearchOpen)
  const toggleSearch = useStore((s) => s.toggleSearch)
  const ghostSuggestion = useStore((s) => s.ghostSuggestion)
  const assistantMode = useStore((s) => s.assistantMode)
  const isShellmateThinking = useStore((s) => s.isShellmateThinking)
  const setShellmateThinking = useStore((s) => s.setShellmateThinking)

  const [shellInput, setShellInput] = useState('')
  const shellInputRef = useRef<HTMLInputElement>(null)
  const lastErrorRef = useRef(0)

  const isShellmate = assistantMode === 'terminal'

  // ── ANSI helpers for styled terminal output ───────────────────────────
  const ANSI = {
    reset:     '\x1b[0m',
    bold:      '\x1b[1m',
    dim:       '\x1b[2m',
    italic:    '\x1b[3m',
    // Foregrounds
    cyan:      '\x1b[36m',
    green:     '\x1b[32m',
    yellow:    '\x1b[33m',
    red:       '\x1b[31m',
    magenta:   '\x1b[35m',
    blue:      '\x1b[34m',
    white:     '\x1b[37m',
    gray:      '\x1b[90m',
    brightCyan:    '\x1b[96m',
    brightGreen:   '\x1b[92m',
    brightYellow:  '\x1b[93m',
    brightMagenta: '\x1b[95m',
    brightWhite:   '\x1b[97m',
    // Backgrounds
    bgBlue:    '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgGray:    '\x1b[100m',
  }

  const writeLine = (text: string) => {
    termRef.current?.write(text + '\r\n')
  }

  const writeShellmateDivider = () => {
    const cols = termRef.current?.cols || 80
    const line = '─'.repeat(cols - 2)
    writeLine(`${ANSI.dim}${ANSI.cyan}${line}${ANSI.reset}`)
  }

  const writeUserPrompt = (prompt: string) => {
    writeLine('')
    writeShellmateDivider()
    writeLine(`${ANSI.bold}${ANSI.brightCyan} 🧑 YOU ${ANSI.reset}${ANSI.dim}${ANSI.cyan} ▸ ${ANSI.reset}${ANSI.white}${prompt}${ANSI.reset}`)
    writeShellmateDivider()
  }

  const writeAiHeader = () => {
    writeLine(`${ANSI.bold}${ANSI.brightMagenta} 🤖 SHELLMATE ${ANSI.reset}`)
  }

  const writeAiText = (text: string) => {
    writeLine(`${ANSI.white}   ${text}${ANSI.reset}`)
  }

  const writeAiCommand = (cmd: string) => {
    writeLine(`${ANSI.bold}${ANSI.brightGreen}   ▶ ${ANSI.reset}${ANSI.bold}${ANSI.green}${cmd}${ANSI.reset}`)
  }

  const writeAiWarning = (text: string) => {
    writeLine(`${ANSI.bold}${ANSI.brightYellow}   ⚠ ${ANSI.reset}${ANSI.yellow}${text}${ANSI.reset}`)
  }

  const writeExecuting = (cmd: string) => {
    writeLine('')
    writeLine(`${ANSI.dim}${ANSI.gray}   ┌─ executing ──────────────────────────${ANSI.reset}`)
    writeLine(`${ANSI.dim}${ANSI.gray}   │ ${ANSI.reset}${ANSI.brightGreen}$ ${cmd}${ANSI.reset}`)
    writeLine(`${ANSI.dim}${ANSI.gray}   └──────────────────────────────────────${ANSI.reset}`)
  }

  const writeEndBlock = () => {
    const cols = termRef.current?.cols || 80
    const line = '─'.repeat(cols - 2)
    writeLine(`${ANSI.dim}${ANSI.cyan}${line}${ANSI.reset}`)
    writeLine('')
  }

  // ── Shellmate send handler ────────────────────────────────────────────
  const sendShellmate = useCallback(async (override?: string) => {
    const msg = override || shellInput.trim()
    if (!msg || isShellmateThinking) return
    setShellInput('')
    setShellmateThinking(true)

    // Write the user's question to the terminal
    writeUserPrompt(msg)

    // Show thinking indicator
    writeLine(`${ANSI.dim}${ANSI.magenta}   ⏳ thinking...${ANSI.reset}`)

    try {
      const context = (window as any).__getTerminalContext?.() || ''
      const res = await fetch('/api/shellmate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          terminal_context: context,
          session_id: sessionId,
        }),
      })
      const data = await res.json()

      if (data.error) {
        // Clear thinking line by overwriting
        writeLine(`${ANSI.red}   Error: ${data.error}${ANSI.reset}`)
        writeEndBlock()
        return
      }

      // Clear the thinking line (move cursor up and clear)
      termRef.current?.write('\x1b[1A\x1b[2K')

      // Render AI response header
      writeAiHeader()

      const segments: Array<{ type: string; text: string }> = data.segments || []
      const commands: string[] = []

      // Render each segment
      for (const seg of segments) {
        switch (seg.type) {
          case 'text':
            writeAiText(seg.text)
            break
          case 'command':
            writeAiCommand(seg.text)
            commands.push(seg.text)
            break
          case 'warning':
            writeAiWarning(seg.text)
            break
        }
      }

      writeLine('')

      // Execute commands sequentially with visual separation
      if (commands.length > 0) {
        for (let i = 0; i < commands.length; i++) {
          const cmd = commands[i]
          writeExecuting(cmd)
          // Actually run in the shell
          const ws = wsRef.current
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(new TextEncoder().encode(cmd + '\n'))
            // Wait a bit for output before next command
            await new Promise((r) => setTimeout(r, 800))
          }
        }
      }

      writeEndBlock()
    } catch (err: any) {
      writeLine(`${ANSI.red}   Network error: ${err.message}${ANSI.reset}`)
      writeEndBlock()
    } finally {
      setShellmateThinking(false)
      // Refocus the input after response
      setTimeout(() => shellInputRef.current?.focus(), 100)
    }
  }, [shellInput, isShellmateThinking, sessionId, setShellmateThinking])

  // Focus shellmate input when mode changes
  useEffect(() => {
    if (isShellmate) {
      setTimeout(() => shellInputRef.current?.focus(), 200)
      // Print welcome banner in terminal
      const term = termRef.current
      if (term) {
        writeLine('')
        writeShellmateDivider()
        writeLine(`${ANSI.bold}${ANSI.brightMagenta} 🤖 SHELLMATE MODE ACTIVE ${ANSI.reset}`)
        writeLine(`${ANSI.dim}   Type below to ask AI anything. Commands auto-execute.${ANSI.reset}`)
        writeLine(`${ANSI.dim}   Your terminal is still fully functional — click to use it normally.${ANSI.reset}`)
        writeShellmateDivider()
        writeLine('')
      }
    }
  }, [isShellmate])

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
      <div className={`terminal-toolbar ${isShellmate ? 'shellmate-active' : ''}`}>
        <div className="terminal-toolbar-left">
          <span className="toolbar-label">
            {isShellmate ? (
              <>
                <Sparkles size={13} className="toolbar-icon shellmate-icon" />
                Shellmate
              </>
            ) : (
              <>
                <TerminalSquare size={13} className="toolbar-icon" />
                Terminal
              </>
            )}
          </span>
          {isShellmate ? (
            <span className="toolbar-chip shellmate-chip">
              <span className="shellmate-dot" />
              AI Interactive
            </span>
          ) : (
            <span className="toolbar-chip">bash</span>
          )}
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

      {/* Shellmate input bar */}
      {isShellmate && (
        <div className="shellmate-input-bar">
          <div className="shellmate-input-wrapper">
            <Sparkles size={14} className="shellmate-input-icon" />
            <input
              ref={shellInputRef}
              type="text"
              className="shellmate-input"
              placeholder={isShellmateThinking ? 'AI is thinking...' : 'Ask Shellmate anything... (commands auto-execute)'}
              value={shellInput}
              onChange={(e) => setShellInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendShellmate()
                }
              }}
              disabled={isShellmateThinking}
            />
            <button
              className="shellmate-send-btn"
              onClick={() => sendShellmate()}
              disabled={isShellmateThinking || !shellInput.trim()}
              title="Send to Shellmate"
            >
              {isShellmateThinking ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
            </button>
          </div>
          <div className="shellmate-input-hint">
            Enter to send · Click terminal to use normally · AI responses render inline
          </div>
        </div>
      )}
    </div>
  )
}
