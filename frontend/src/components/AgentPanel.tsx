import { useRef, useEffect, useCallback, useState } from 'react'
import { useStore, type AgentEvent, type UploadedAttachment } from '../store'
import {
  Cpu, Send, Loader2, AlertCircle, CheckCircle, Wrench, Brain,
  Paperclip, Mic, MicOff, Camera, X, Image as ImageIcon, Volume2,
} from 'lucide-react'
import { Marked } from 'marked'
import hljs from 'highlight.js'
import { markedHighlight } from 'marked-highlight'
import 'highlight.js/styles/github-dark.css'
import './AgentPanel.css'

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value
      return hljs.highlightAuto(code).value
    },
  })
)

/** Lightweight HTML sanitizer — strips script/iframe/event handlers */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
}

// ── Upload helper ────────────────────────────────────────────────────────

async function uploadFile(file: File): Promise<UploadedAttachment | null> {
  const form = new FormData()
  form.append('file', file)
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form })
    if (!res.ok) return null
    const data = await res.json()
    const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let previewUrl: string | undefined
    if (file.type.startsWith('image/')) {
      previewUrl = URL.createObjectURL(file)
    }
    return { id: data.id, localId, name: data.name, mime_type: data.mime_type, size: data.size, previewUrl }
  } catch {
    return null
  }
}

// ── Component ────────────────────────────────────────────────────────────

export function AgentPanel() {
  const events = useStore((s) => s.agentEvents)
  const addEvent = useStore((s) => s.addAgentEvent)
  const clearEvents = useStore((s) => s.clearAgentEvents)
  const isRunning = useStore((s) => s.isAgentRunning)
  const setRunning = useStore((s) => s.setAgentRunning)
  const input = useStore((s) => s.agentInput)
  const setInput = useStore((s) => s.setAgentInput)
  const sessionId = useStore((s) => s.sessionId)
  const addToast = useStore((s) => s.addToast)

  // Attachments
  const attachments = useStore((s) => s.attachments)
  const addAttachment = useStore((s) => s.addAttachment)
  const removeAttachment = useStore((s) => s.removeAttachment)
  const clearAttachments = useStore((s) => s.clearAttachments)

  // Thinking mode
  const thinkingEnabled = useStore((s) => s.thinkingEnabled)
  const toggleThinking = useStore((s) => s.toggleThinking)

  // Audio recording
  const isRecording = useStore((s) => s.isRecording)
  const setRecording = useStore((s) => s.setRecording)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  const eventsRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (eventsRef.current) eventsRef.current.scrollTop = eventsRef.current.scrollHeight
  }, [events])

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px'
    }
  }, [input])

  // ── File upload handler ────────────────────────────────────────────
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('audio/')) {
        addToast({ type: 'warning', message: `Unsupported: ${file.name}. Use images or audio.` })
        continue
      }
      const att = await uploadFile(file)
      if (att) {
        addAttachment(att)
      } else {
        addToast({ type: 'error', message: `Failed to upload ${file.name}` })
      }
    }
  }, [addAttachment, addToast])

  // ── Paste handler (Ctrl+V images) ─────────────────────────────────
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const imageFiles: File[] = []
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) imageFiles.push(file)
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault()
        handleFiles(imageFiles)
      }
    }
    window.addEventListener('paste', handler)
    return () => window.removeEventListener('paste', handler)
  }, [handleFiles])

  // ── Audio recording ───────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      audioChunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: mimeType })
        const att = await uploadFile(file)
        if (att) {
          addAttachment(att)
          addToast({ type: 'success', message: 'Audio recorded', duration: 2000 })
        }
        setRecording(false)
      }

      mediaRecorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch (err: any) {
      addToast({ type: 'error', message: `Microphone error: ${err.message}` })
    }
  }, [addAttachment, addToast, setRecording])

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop()
  }, [])

  // ── Terminal screenshot ───────────────────────────────────────────
  const captureTerminal = useCallback(async () => {
    const canvas = document.querySelector('.terminal-xterm canvas') as HTMLCanvasElement | null
    if (!canvas) {
      addToast({ type: 'warning', message: 'No terminal canvas found' })
      return
    }
    canvas.toBlob(async (blob) => {
      if (!blob) return
      const file = new File([blob], `terminal-${Date.now()}.png`, { type: 'image/png' })
      const att = await uploadFile(file)
      if (att) {
        addAttachment(att)
        addToast({ type: 'success', message: 'Terminal screenshot captured', duration: 2000 })
      }
    }, 'image/png')
  }, [addAttachment, addToast])

  // ── Run agent ─────────────────────────────────────────────────────
  const runAgent = useCallback(async (goal?: string) => {
    const msg = goal || input.trim()
    if (!msg || isRunning) return
    setInput('')
    setRunning(true)

    // Gather attachment IDs and clear
    const currentAttachments = useStore.getState().attachments
    const attachmentIds = currentAttachments.map((a) => a.id)
    const attachmentPreviews = currentAttachments.map((a) => ({
      name: a.name,
      mime_type: a.mime_type,
      previewUrl: a.previewUrl,
    }))
    clearAttachments()

    // Add user message event (with attachment info)
    addEvent({
      id: `user-${Date.now()}`,
      type: 'text',
      data: { text: msg, role: 'user', attachments: attachmentPreviews.length > 0 ? attachmentPreviews : undefined },
      timestamp: Date.now(),
    })

    try {
      const terminalContext = (window as any).__getTerminalContext?.() || ''

      const res = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: msg + (terminalContext ? `\n\n<terminal_context>\n${terminalContext}\n</terminal_context>` : ''),
          session_id: sessionId,
          attachment_ids: attachmentIds,
        }),
      })

      if (!res.ok) {
        addEvent({ id: `err-${Date.now()}`, type: 'error', data: { error: `HTTP ${res.status}` }, timestamp: Date.now() })
        return
      }

      const reader = res.body?.getReader()
      if (!reader) return

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6))
              addEvent({ id: `${eventType}-${Date.now()}-${Math.random()}`, type: eventType as any, data, timestamp: Date.now() })
            } catch {}
            eventType = ''
          }
        }
      }
    } catch (err: any) {
      addEvent({ id: `err-${Date.now()}`, type: 'error', data: { error: err.message }, timestamp: Date.now() })
    } finally {
      setRunning(false)
    }
  }, [input, isRunning, sessionId, addEvent, setInput, setRunning, addToast, clearAttachments])

  // ── Drop zone ─────────────────────────────────────────────────────
  const [isDragOver, setDragOver] = useState(false)

  return (
    <div
      className={`agent-panel ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files) }}
    >
      {/* Header */}
      <div className="agent-header">
        <div className="agent-header-left">
          <Cpu size={14} className="agent-header-icon" />
          <span className="agent-header-title">Agent</span>
        </div>
        <div className="agent-header-right">
          <span className="agent-badge">Gemini 3</span>
          <button
            className={`agent-badge thinking-badge ${thinkingEnabled ? 'on' : 'off'}`}
            onClick={toggleThinking}
            title={thinkingEnabled ? 'Thinking mode ON — click to disable' : 'Thinking mode OFF — click to enable'}
          >
            <Brain size={10} />
            {thinkingEnabled ? 'Thinking' : 'Thinking Off'}
          </button>
          <button className="agent-clear-btn" onClick={clearEvents} title="Clear">Clear</button>
        </div>
      </div>

      {/* Events feed */}
      <div className="agent-events" ref={eventsRef}>
        {events.length === 0 && (
          <div className="agent-empty">
            <Cpu size={32} strokeWidth={1.5} />
            <p>Give the agent a goal. It will <strong>think</strong>, plan, execute commands, and report results.</p>
            <p className="agent-empty-hint">Attach images, screenshots, or record audio for multimodal input.</p>
            <div className="agent-examples">
              {['Install and configure nginx', 'Find all large files over 100MB', 'Show system resource usage', 'Create a Python web server'].map((ex) => (
                <button key={ex} className="agent-example-btn" onClick={() => runAgent(ex)}>{ex}</button>
              ))}
            </div>
          </div>
        )}

        {events.map((ev) => (
          <EventCard key={ev.id} event={ev} />
        ))}

        {isRunning && (
          <div className="agent-thinking">
            <Loader2 size={14} className="spin" />
            <span>Agent is working...</span>
          </div>
        )}
      </div>

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="attachment-bar">
          {attachments.map((att) => (
            <div key={att.localId} className="attachment-chip">
              {att.previewUrl ? (
                <img src={att.previewUrl} alt={att.name} className="attachment-thumb" />
              ) : att.mime_type.startsWith('audio/') ? (
                <Volume2 size={14} />
              ) : (
                <Paperclip size={14} />
              )}
              <span className="attachment-name">{att.name}</span>
              <button className="attachment-remove" onClick={() => removeAttachment(att.localId)}><X size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="agent-input-area">
        <div className="input-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,audio/*"
            multiple
            hidden
            onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }}
          />
          <button
            className="input-action-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={isRunning}
            title="Attach image or audio"
          >
            <Paperclip size={15} />
          </button>
          <button
            className="input-action-btn"
            onClick={captureTerminal}
            disabled={isRunning}
            title="Screenshot terminal"
          >
            <Camera size={15} />
          </button>
          <button
            className={`input-action-btn ${isRecording ? 'recording' : ''}`}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isRunning}
            title={isRecording ? 'Stop recording' : 'Record audio'}
          >
            {isRecording ? <MicOff size={15} /> : <Mic size={15} />}
          </button>
        </div>
        <textarea
          ref={inputRef}
          className="agent-input"
          rows={1}
          placeholder="Give the agent a goal..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAgent() } }}
          disabled={isRunning}
        />
        <button className="agent-send-btn" onClick={() => runAgent()} disabled={isRunning || (!input.trim() && attachments.length === 0)} title="Run">
          {isRunning ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
        </button>
      </div>

      {/* Drag overlay */}
      {isDragOver && (
        <div className="drag-overlay">
          <ImageIcon size={32} />
          <span>Drop images or audio files</span>
        </div>
      )}
    </div>
  )
}

// ── Event card ───────────────────────────────────────────────────────────

function EventCard({ event }: { event: AgentEvent }) {
  const { type, data } = event
  const [thoughtExpanded, setThoughtExpanded] = useState(true)

  if (type === 'text' && data.role === 'user') {
    return (
      <div className="event-card event-user">
        <div className="event-icon"><Brain size={12} /></div>
        <div className="event-body">
          <div>{data.text}</div>
          {data.attachments && (
            <div className="user-attachments">
              {data.attachments.map((att: any, i: number) => (
                <span key={i} className="user-attachment-chip">
                  {att.previewUrl ? (
                    <img src={att.previewUrl} alt={att.name} className="user-attachment-thumb" />
                  ) : att.mime_type?.startsWith('audio/') ? (
                    <><Volume2 size={11} /> {att.name}</>
                  ) : (
                    <><Paperclip size={11} /> {att.name}</>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (type === 'text') {
    const raw = marked.parse(data.text || '')
    const html = sanitizeHtml(typeof raw === 'string' ? raw : '')
    return (
      <div className="event-card event-response">
        <div className="event-icon event-icon-agent"><Cpu size={12} /></div>
        <div className="event-body markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    )
  }

  if (type === 'tool_call') {
    return (
      <div className="event-card event-tool-call">
        <div className="event-icon event-icon-tool"><Wrench size={11} /></div>
        <div className="event-body">
          <span className="tool-name">{data.tool}</span>
          <code className="tool-args">{JSON.stringify(data.args, null, 0)}</code>
        </div>
      </div>
    )
  }

  if (type === 'tool_result') {
    let resultText = data.result || ''
    if (typeof resultText === 'string' && resultText.startsWith('{')) {
      try {
        const parsed = JSON.parse(resultText)
        resultText = parsed.output || parsed.content || JSON.stringify(parsed, null, 2)
      } catch {}
    }
    const truncated = typeof resultText === 'string' && resultText.length > 600
    return (
      <div className="event-card event-tool-result">
        <div className="event-icon event-icon-result"><CheckCircle size={11} /></div>
        <div className="event-body">
          <pre className="tool-output">{truncated ? resultText.slice(0, 600) + '...' : resultText}</pre>
        </div>
      </div>
    )
  }

  if (type === 'thought') {
    return (
      <div className="event-card event-thought">
        <div className="thought-header" onClick={() => setThoughtExpanded((v) => !v)}>
          <Brain size={12} className="thought-icon" />
          <span className="thought-label">Thinking</span>
          <span className="thought-toggle">{thoughtExpanded ? '▾' : '▸'}</span>
        </div>
        {thoughtExpanded && (
          <div className="thought-body">{data.text}</div>
        )}
      </div>
    )
  }

  if (type === 'error') {
    return (
      <div className="event-card event-error">
        <div className="event-icon event-icon-error"><AlertCircle size={11} /></div>
        <div className="event-body">{data.error}</div>
      </div>
    )
  }

  if (type === 'status') {
    return (
      <div className="event-card event-status">
        <Loader2 size={11} className="spin" />
        <span>{data.status}</span>
      </div>
    )
  }

  return null
}
