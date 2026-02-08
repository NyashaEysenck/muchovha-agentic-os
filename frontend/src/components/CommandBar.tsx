import { useRef, useEffect, useCallback, useState } from 'react'
import { useStore, type UploadedAttachment } from '../store'
import {
  Send, Square, Paperclip, Mic, MicOff, Camera, X,
  Volume2, Image as ImageIcon, Loader2, Brain,
} from 'lucide-react'
import './CommandBar.css'

async function uploadFile(file: File): Promise<UploadedAttachment | null> {
  const form = new FormData()
  form.append('file', file)
  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form })
    if (!res.ok) return null
    const data = await res.json()
    const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    let previewUrl: string | undefined
    if (file.type.startsWith('image/')) previewUrl = URL.createObjectURL(file)
    return { id: data.id, localId, name: data.name, mime_type: data.mime_type, size: data.size, previewUrl }
  } catch { return null }
}

type AgentStatus = 'idle' | 'thinking' | 'executing' | 'monitoring' | 'healing'

function deriveStatus(isRunning: boolean, events: any[], autoHeal: boolean): AgentStatus {
  if (!isRunning && !autoHeal) return 'idle'
  if (!isRunning && autoHeal) return 'monitoring'
  const last = events[events.length - 1]
  if (last?.type === 'thought') return 'thinking'
  if (last?.type === 'tool_call') return 'executing'
  return 'thinking'
}

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'IDLE',
  thinking: 'THINKING',
  executing: 'EXECUTING',
  monitoring: 'MONITORING',
  healing: 'HEALING',
}

export function CommandBar() {
  const input = useStore((s) => s.agentInput)
  const setInput = useStore((s) => s.setAgentInput)
  const isRunning = useStore((s) => s.isAgentRunning)
  const setRunning = useStore((s) => s.setAgentRunning)
  const addEvent = useStore((s) => s.addAgentEvent)
  const clearEvents = useStore((s) => s.clearAgentEvents)
  const sessionId = useStore((s) => s.sessionId)
  const addToast = useStore((s) => s.addToast)
  const events = useStore((s) => s.agentEvents)
  const autoHealEnabled = useStore((s) => s.autoHealEnabled)
  const thinkingEnabled = useStore((s) => s.thinkingEnabled)
  const toggleThinking = useStore((s) => s.toggleThinking)

  // Attachments
  const attachments = useStore((s) => s.attachments)
  const addAttachment = useStore((s) => s.addAttachment)
  const removeAttachment = useStore((s) => s.removeAttachment)
  const clearAttachments = useStore((s) => s.clearAttachments)

  // Audio recording
  const isRecording = useStore((s) => s.isRecording)
  const setRecording = useStore((s) => s.setRecording)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const status = deriveStatus(isRunning, events, autoHealEnabled)

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 80) + 'px'
    }
  }, [input])

  // ── File upload ───────────────────────────────────────────────────
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/') && !file.type.startsWith('audio/')) {
        addToast({ type: 'warning', message: `Unsupported: ${file.name}` })
        continue
      }
      const att = await uploadFile(file)
      if (att) addAttachment(att)
      else addToast({ type: 'error', message: `Failed to upload ${file.name}` })
    }
  }, [addAttachment, addToast])

  // ── Paste handler ─────────────────────────────────────────────────
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
      if (imageFiles.length > 0) { e.preventDefault(); handleFiles(imageFiles) }
    }
    window.addEventListener('paste', handler)
    return () => window.removeEventListener('paste', handler)
  }, [handleFiles])

  // ── Audio recording ───────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      audioChunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: mimeType })
        const att = await uploadFile(file)
        if (att) { addAttachment(att); addToast({ type: 'success', message: 'Audio recorded', duration: 2000 }) }
        setRecording(false)
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setRecording(true)
    } catch (err: any) { addToast({ type: 'error', message: `Mic error: ${err.message}` }) }
  }, [addAttachment, addToast, setRecording])

  const stopRecording = useCallback(() => { mediaRecorderRef.current?.stop() }, [])

  // ── Terminal screenshot ───────────────────────────────────────────
  const captureTerminal = useCallback(async () => {
    const canvas = document.querySelector('.terminal-xterm canvas') as HTMLCanvasElement | null
    if (!canvas) { addToast({ type: 'warning', message: 'No terminal canvas' }); return }
    canvas.toBlob(async (blob) => {
      if (!blob) return
      const file = new File([blob], `terminal-${Date.now()}.png`, { type: 'image/png' })
      const att = await uploadFile(file)
      if (att) { addAttachment(att); addToast({ type: 'success', message: 'Screenshot captured', duration: 2000 }) }
    }, 'image/png')
  }, [addAttachment, addToast])

  // ── Stop agent ────────────────────────────────────────────────────
  const stopAgent = useCallback(async () => {
    abortRef.current?.abort()
    abortRef.current = null
    try { await fetch('/api/agent/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: sessionId }) }) } catch {}
  }, [sessionId])

  // ── Run agent ─────────────────────────────────────────────────────
  const runAgent = useCallback(async (goal?: string) => {
    const msg = goal || input.trim()
    if (!msg || isRunning) return
    setInput('')
    setRunning(true)
    const controller = new AbortController()
    abortRef.current = controller

    const currentAttachments = useStore.getState().attachments
    const attachmentIds = currentAttachments.map((a) => a.id)
    const attachmentPreviews = currentAttachments.map((a) => ({ name: a.name, mime_type: a.mime_type, previewUrl: a.previewUrl }))
    clearAttachments()

    addEvent({ id: `user-${Date.now()}`, type: 'text', data: { text: msg, role: 'user', attachments: attachmentPreviews.length > 0 ? attachmentPreviews : undefined }, timestamp: Date.now() })

    try {
      const terminalContext = (window as any).__getTerminalContext?.() || ''
      const res = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: msg + (terminalContext ? `\n\n<terminal_context>\n${terminalContext}\n</terminal_context>` : ''), session_id: sessionId, attachment_ids: attachmentIds }),
        signal: controller.signal,
      })
      if (!res.ok) { addEvent({ id: `err-${Date.now()}`, type: 'error', data: { error: `HTTP ${res.status}` }, timestamp: Date.now() }); return }
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
          if (line.startsWith('event: ')) eventType = line.slice(7).trim()
          else if (line.startsWith('data: ') && eventType) {
            try {
              const data = JSON.parse(line.slice(6))
              addEvent({ id: `${eventType}-${Date.now()}-${Math.random()}`, type: eventType as any, data, timestamp: Date.now() })
            } catch {}
            eventType = ''
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') addEvent({ id: `stop-${Date.now()}`, type: 'status', data: { status: 'Agent stopped.' }, timestamp: Date.now() })
      else addEvent({ id: `err-${Date.now()}`, type: 'error', data: { error: err.message }, timestamp: Date.now() })
    } finally { abortRef.current = null; setRunning(false) }
  }, [input, isRunning, sessionId, addEvent, setInput, setRunning, addToast, clearAttachments])

  // ── Watch for queued goals (from AlertFeed "Fix" button) ───────────
  const queuedGoal = useStore((s) => s.queuedGoal)
  const consumeQueuedGoal = useStore((s) => s.consumeQueuedGoal)

  useEffect(() => {
    if (queuedGoal && !isRunning) {
      const goal = consumeQueuedGoal()
      if (goal) runAgent(goal)
    }
  }, [queuedGoal, isRunning, consumeQueuedGoal, runAgent])

  // ── Drop handler ──────────────────────────────────────────────────
  const [isDragOver, setDragOver] = useState(false)

  return (
    <div
      className={`command-bar ${isDragOver ? 'drag-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files) }}
    >
      {/* Status indicator */}
      <div className={`cmd-status cmd-status-${status}`}>
        {isRunning ? <Loader2 size={12} className="spin" /> : <div className={`status-orb ${status}`} />}
        <span>{STATUS_LABELS[status]}</span>
      </div>

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="cmd-attachments">
          {attachments.map((att) => (
            <div key={att.localId} className="cmd-att-chip">
              {att.previewUrl ? <img src={att.previewUrl} alt={att.name} className="cmd-att-thumb" /> : att.mime_type.startsWith('audio/') ? <Volume2 size={12} /> : <Paperclip size={12} />}
              <span>{att.name}</span>
              <button onClick={() => removeAttachment(att.localId)}><X size={10} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Main input row */}
      <div className="cmd-input-row">
        <div className="cmd-actions">
          <input ref={fileInputRef} type="file" accept="image/*,audio/*" multiple hidden onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = '' }} />
          <button className="cmd-action" onClick={() => fileInputRef.current?.click()} disabled={isRunning} title="Attach"><Paperclip size={14} /></button>
          <button className="cmd-action" onClick={captureTerminal} disabled={isRunning} title="Screenshot"><Camera size={14} /></button>
          <button className={`cmd-action ${isRecording ? 'recording' : ''}`} onClick={isRecording ? stopRecording : startRecording} disabled={isRunning} title="Record">{isRecording ? <MicOff size={14} /> : <Mic size={14} />}</button>
          <div className="cmd-divider" />
          <button className={`cmd-action cmd-thinking ${thinkingEnabled ? 'active' : ''}`} onClick={toggleThinking} title={thinkingEnabled ? 'Thinking ON' : 'Thinking OFF'}><Brain size={14} /></button>
          <button className="cmd-action" onClick={clearEvents} title="Clear history"><X size={14} /></button>
        </div>

        <textarea
          ref={inputRef}
          className="cmd-input"
          rows={1}
          placeholder="Give the agent a goal..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAgent() } }}
          disabled={isRunning}
        />

        {isRunning ? (
          <button className="cmd-stop" onClick={stopAgent} title="Stop"><Square size={12} /></button>
        ) : (
          <button className="cmd-send" onClick={() => runAgent()} disabled={!input.trim() && attachments.length === 0} title="Run"><Send size={14} /></button>
        )}
      </div>

      {/* Drop overlay */}
      {isDragOver && (
        <div className="cmd-drop-overlay">
          <ImageIcon size={20} />
          <span>Drop files</span>
        </div>
      )}
    </div>
  )
}
