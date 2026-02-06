import { useState, useRef, useEffect, useCallback } from 'react'
import { useStore, type ChatMessage, type Attachment } from '../store'
import { RichMarkdown } from './RichMarkdown'
import {
  Sparkles, Send, Lightbulb, Wrench, BookOpen, Shield, FolderOpen, Package,
  Bot, User, Image, Mic, MicOff, Camera, X, Paperclip, Loader2
} from 'lucide-react'
import './ChatPanel.css'

let _attachId = 0
const attachUid = () => `att-${Date.now()}-${++_attachId}`

export function ChatPanel() {
  const messages = useStore((s) => s.chatMessages)
  const addMessage = useStore((s) => s.addChatMessage)
  const updateMessage = useStore((s) => s.updateChatMessage)
  const sessionId = useStore((s) => s.sessionId)
  const assistantMode = useStore((s) => s.assistantMode)
  const isThinking = useStore((s) => s.isAiThinking)
  const setThinking = useStore((s) => s.setAiThinking)
  const addToast = useStore((s) => s.addToast)

  // Multimodal state
  const attachments = useStore((s) => s.attachments)
  const addAttachment = useStore((s) => s.addAttachment)
  const removeAttachment = useStore((s) => s.removeAttachment)
  const clearAttachments = useStore((s) => s.clearAttachments)
  const isRecording = useStore((s) => s.isRecording)
  const setRecording = useStore((s) => s.setRecording)
  const recordingDuration = useStore((s) => s.recordingDuration)
  const setRecordingDuration = useStore((s) => s.setRecordingDuration)

  const [input, setInput] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const messagesRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages, isThinking])

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 120) + 'px'
    }
  }, [input])

  const getContext = () => (window as any).__getTerminalContext?.() || ''

  const extractCommands = (text: string): string[] => {
    const blocks = [...text.matchAll(/```(?:bash|sh|shell)?\n([\s\S]*?)```/g)]
    const cmds: string[] = []
    for (const match of blocks) {
      const body = (match[1] || '').trim()
      if (!body) continue
      const lines = body.split('\n').map((l) => l.replace(/^\$\s?/, '').trim())
      for (const line of lines) {
        if (!line) continue
        if (line.startsWith('#') || line.startsWith('//')) continue
        cmds.push(line)
      }
    }
    return cmds
  }

  const runCommands = (commands: string[]) => {
    const runInTerminal = (window as any).__runInTerminal
    if (!runInTerminal || commands.length === 0) return
    commands.forEach((cmd, idx) => {
      setTimeout(() => runInTerminal(cmd), idx * 200)
    })
  }

  const postProcessAiResponse = (text: string) => {
    if (assistantMode === 'autopilot') {
      const commands = extractCommands(text)
      if (commands.length) {
        addToast({ type: 'info', message: `Autopilot running ${commands.length} command(s)` })
        runCommands(commands)
      }
    }
  }

  // ── File handling ─────────────────────────────────────────────────────

  const handleFiles = useCallback((files: FileList | File[]) => {
    const allowed = [
      'image/png', 'image/jpeg', 'image/gif', 'image/webp',
      'audio/webm', 'audio/ogg', 'audio/wav', 'audio/mp3', 'audio/mpeg', 'audio/mp4',
    ]
    for (const file of Array.from(files)) {
      if (!allowed.includes(file.type)) {
        addToast({ type: 'warning', message: `Unsupported file: ${file.name}` })
        continue
      }
      const isImage = file.type.startsWith('image/')
      const att: Attachment = {
        id: attachUid(),
        file,
        type: isImage ? 'image' : 'audio',
        name: file.name,
      }
      // Generate preview for images
      if (isImage) {
        const reader = new FileReader()
        reader.onload = (e) => {
          att.preview = e.target?.result as string
          // Force re-render by updating the attachment
          useStore.getState().removeAttachment(att.id)
          useStore.getState().addAttachment({ ...att })
        }
        reader.readAsDataURL(file)
      }
      addAttachment(att)
    }
  }, [addAttachment, addToast])

  const handleFileSelect = () => fileInputRef.current?.click()

  // ── Screenshot capture ─────────────────────────────────────────────────

  const captureScreenshot = useCallback(async () => {
    // Grab the terminal canvas element
    const termCanvas = document.querySelector('.terminal-xterm canvas') as HTMLCanvasElement
    if (!termCanvas) {
      addToast({ type: 'warning', message: 'Terminal not available for screenshot' })
      return
    }
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        termCanvas.toBlob(resolve, 'image/png')
      )
      if (!blob) {
        addToast({ type: 'warning', message: 'Failed to capture screenshot' })
        return
      }
      const file = new File([blob], 'terminal-screenshot.png', { type: 'image/png' })
      const preview = termCanvas.toDataURL('image/png')
      addAttachment({
        id: attachUid(),
        file,
        type: 'image',
        name: 'Terminal Screenshot',
        preview,
      })
      addToast({ type: 'success', message: 'Terminal screenshot captured', duration: 2000 })
    } catch {
      addToast({ type: 'warning', message: 'Screenshot capture failed' })
    }
  }, [addAttachment, addToast])

  // ── Audio recording ────────────────────────────────────────────────────

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      })
      audioChunksRef.current = []
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' })
        const file = new File([blob], 'voice-message.webm', { type: 'audio/webm' })
        const duration = useStore.getState().recordingDuration
        addAttachment({
          id: attachUid(),
          file,
          type: 'audio',
          name: `Voice message (${duration}s)`,
          duration,
        })
        setRecording(false)
        setRecordingDuration(0)
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current)
        addToast({ type: 'success', message: 'Voice message recorded', duration: 2000 })
      }

      mediaRecorder.start(250) // collect data every 250ms
      setRecording(true)
      setRecordingDuration(0)

      // Duration counter
      let sec = 0
      recordingTimerRef.current = setInterval(() => {
        sec++
        setRecordingDuration(sec)
        if (sec >= 300) stopRecording() // max 5 min
      }, 1000)

    } catch (err: any) {
      addToast({ type: 'error', message: 'Microphone access denied: ' + (err.message || 'unknown error') })
    }
  }, [addAttachment, addToast, setRecording, setRecordingDuration])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current)
      recordingTimerRef.current = null
    }
  }, [])

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording()
    } else {
      startRecording()
    }
  }, [isRecording, startRecording, stopRecording])

  // ── Drag & drop ────────────────────────────────────────────────────────

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files)
    }
  }, [handleFiles])

  // ── Send with multimodal support ───────────────────────────────────────

  const send = useCallback(async (overrideMsg?: string) => {
    const msg = overrideMsg || input.trim()
    const hasAttachments = attachments.length > 0
    if ((!msg && !hasAttachments) || isThinking) return

    if (!overrideMsg) setInput('')
    const currentAttachments = [...attachments]
    clearAttachments()

    // Build display text for user message
    let displayText = msg
    if (currentAttachments.length > 0) {
      const labels = currentAttachments.map((a) =>
        a.type === 'image' ? `[Image: ${a.name}]` : `[Audio: ${a.name}]`
      )
      displayText = labels.join(' ') + (msg ? '\n' + msg : '')
    }

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: displayText,
      timestamp: Date.now(),
    }
    addMessage(userMsg)
    setThinking(true)

    const aiId = `ai-${Date.now()}`
    addMessage({
      id: aiId,
      role: 'ai',
      text: '',
      timestamp: Date.now(),
      streaming: true,
    })

    try {
      let data: any

      if (currentAttachments.length > 0) {
        // Multimodal: use FormData
        const formData = new FormData()
        formData.append('message', msg)
        formData.append('terminal_context', getContext())
        formData.append('session_id', sessionId)
        formData.append('mode', assistantMode)
        for (const att of currentAttachments) {
          formData.append('files', att.file)
        }
        const res = await fetch('/api/chat/multimodal', {
          method: 'POST',
          body: formData,
        })
        data = await res.json()
      } else {
        // Text only: use JSON
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: msg,
            terminal_context: getContext(),
            session_id: sessionId,
            mode: assistantMode,
          }),
        })
        data = await res.json()
      }

      if (data.error) {
        updateMessage(aiId, { text: 'Error: ' + data.error, streaming: false })
      } else {
        const fullText = data.response
        let i = 0
        const chunkSize = 8
        const interval = setInterval(() => {
          i += chunkSize
          if (i >= fullText.length) {
            updateMessage(aiId, { text: fullText, streaming: false })
            postProcessAiResponse(fullText)
            clearInterval(interval)
          } else {
            updateMessage(aiId, { text: fullText.slice(0, i) })
          }
        }, 12)
      }
    } catch (err: any) {
      updateMessage(aiId, {
        text: 'Failed to reach AI: ' + err.message,
        streaming: false,
      })
    } finally {
      setThinking(false)
    }
  }, [input, isThinking, sessionId, attachments, addMessage, updateMessage, setThinking, assistantMode, addToast, clearAttachments])

  const quickActions = [
    { icon: <Lightbulb size={12} />, label: 'Explain output', msg: 'Explain what just happened in my terminal' },
    { icon: <Wrench size={12} />, label: 'Fix error', msg: 'I got an error. What went wrong and how do I fix it?' },
    { icon: <BookOpen size={12} />, label: 'Learn basics', msg: 'Show me essential Linux commands every beginner should know' },
    { icon: <Shield size={12} />, label: 'Permissions', msg: 'Explain Linux file permissions. How do I read and set them?' },
    { icon: <FolderOpen size={12} />, label: 'Files & dirs', msg: 'How do I navigate and manage files and directories in Linux?' },
    { icon: <Package size={12} />, label: 'Install packages', msg: 'How do I install and manage software packages on Ubuntu?' },
  ]

  const handleRunCommand = (cmd: string) => {
    const runInTerminal = (window as any).__runInTerminal
    if (runInTerminal) {
      runInTerminal(cmd)
      addToast({ type: 'success', message: `Running: ${cmd}`, duration: 2500 })
    } else {
      navigator.clipboard.writeText(cmd)
      addToast({ type: 'warning', message: 'Terminal not ready — command copied to clipboard' })
    }
  }

  const handleExplain = (code: string) => {
    send(`Explain this command/code in detail:\n\`\`\`\n${code}\n\`\`\``)
  }

  // ── Paste handler for images ───────────────────────────────────────────

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
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
    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [handleFiles])

  return (
    <div
      className={`chat-panel ${isDragging ? 'drag-active' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="drag-overlay">
          <div className="drag-overlay-content">
            <Image size={32} />
            <span>Drop images or audio here</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-left">
          <Sparkles size={14} className="chat-header-icon" />
          <span className="chat-header-title">AI Mentor</span>
        </div>
        <div className="chat-header-right">
          <span className="chat-model-badge">Gemini 3 Flash</span>
          <span className="chat-model-badge multimodal-badge">Multimodal</span>
        </div>
      </div>

      {/* Quick actions */}
      <div className="chat-quick-actions">
        {quickActions.map((a, i) => (
          <button
            key={i}
            className="quick-action-chip"
            onClick={() => send(a.msg)}
            disabled={isThinking}
          >
            <span className="quick-action-icon">{a.icon}</span>
            {a.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="chat-messages" ref={messagesRef}>
        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onRunCommand={handleRunCommand}
            onExplain={handleExplain}
          />
        ))}

        {isThinking && (
          <div className="thinking-indicator">
            <div className="thinking-dots">
              <span /><span /><span />
            </div>
            <span className="thinking-label">
              {attachments.length > 0 ? 'Processing media...' : 'Analyzing...'}
            </span>
          </div>
        )}
      </div>

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="attachment-bar">
          {attachments.map((att) => (
            <div key={att.id} className={`attachment-chip ${att.type}`}>
              {att.type === 'image' && att.preview ? (
                <img src={att.preview} alt={att.name} className="attachment-thumb" />
              ) : att.type === 'image' ? (
                <Image size={14} />
              ) : (
                <Mic size={14} />
              )}
              <span className="attachment-name">{att.name}</span>
              <button
                className="attachment-remove"
                onClick={() => removeAttachment(att.id)}
                title="Remove"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,audio/webm,audio/ogg,audio/wav,audio/mp3,audio/mpeg"
        multiple
        style={{ display: 'none' }}
        onChange={(e) => {
          if (e.target.files) handleFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {/* Input area */}
      <div className="chat-input-area">
        {/* Multimodal toolbar */}
        <div className="multimodal-toolbar">
          <button
            className="mm-btn"
            onClick={handleFileSelect}
            disabled={isThinking}
            title="Attach image or audio file"
          >
            <Paperclip size={14} />
          </button>
          <button
            className="mm-btn"
            onClick={captureScreenshot}
            disabled={isThinking}
            title="Capture terminal screenshot"
          >
            <Camera size={14} />
          </button>
          <button
            className={`mm-btn ${isRecording ? 'recording' : ''}`}
            onClick={toggleRecording}
            disabled={isThinking}
            title={isRecording ? 'Stop recording' : 'Record voice message'}
          >
            {isRecording ? <MicOff size={14} /> : <Mic size={14} />}
          </button>
          {isRecording && (
            <span className="recording-indicator">
              <span className="recording-dot" />
              Recording {recordingDuration}s
            </span>
          )}
        </div>

        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input"
            rows={1}
            placeholder={
              attachments.length > 0
                ? 'Add a message about your attachment (optional)...'
                : assistantMode === 'autopilot'
                ? 'Autopilot mode: ask and it may run commands'
                : assistantMode === 'terminal'
                ? 'Shellmate mode: AI replies in terminal'
                : 'Ask about Linux, or attach an image / record audio...'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            disabled={isThinking}
          />
          <button
            className="chat-send-btn"
            onClick={() => send()}
            disabled={isThinking || (!input.trim() && attachments.length === 0)}
            title="Send message"
          >
            {isThinking ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
          </button>
        </div>
        <div className="chat-input-hint">
          {assistantMode === 'guided' && 'Shift+Enter for new line · Paste/drop images · Ctrl+V to paste screenshots'}
          {assistantMode === 'autopilot' && 'Autopilot may execute commands · Attach images for visual context'}
          {assistantMode === 'terminal' && 'AI replies in terminal · Voice input available'}
        </div>
      </div>
    </div>
  )
}

function MessageBubble({
  message,
  onRunCommand,
  onExplain,
}: {
  message: ChatMessage
  onRunCommand: (cmd: string) => void
  onExplain: (text: string) => void
}) {
  if (message.role === 'system') {
    return (
      <div className="msg msg-system">
        <RichMarkdown content={message.text} />
      </div>
    )
  }

  if (message.role === 'user') {
    return (
      <div className="msg msg-user">
        <div className="msg-avatar"><User size={12} /></div>
        <div className="msg-body">{message.text}</div>
      </div>
    )
  }

  return (
    <div className={`msg msg-ai ${message.streaming ? 'streaming' : ''}`}>
      <div className="msg-avatar msg-avatar-ai"><Bot size={12} /></div>
      <div className="msg-body">
        {message.text ? (
          <RichMarkdown
            content={message.text}
            onRunCommand={onRunCommand}
            onExplain={onExplain}
          />
        ) : (
          <div className="msg-loading-shimmer" />
        )}
        {message.streaming && <span className="streaming-cursor" />}
      </div>
    </div>
  )
}
