import { useState, useRef, useEffect, useCallback } from 'react'
import { useStore, type ChatMessage } from '../store'
import { RichMarkdown } from './RichMarkdown'
import { Sparkles, Send, Lightbulb, Wrench, BookOpen, Shield, FolderOpen, Package, Bot, User } from 'lucide-react'
import './ChatPanel.css'

export function ChatPanel() {
  const messages = useStore((s) => s.chatMessages)
  const addMessage = useStore((s) => s.addChatMessage)
  const updateMessage = useStore((s) => s.updateChatMessage)
  const sessionId = useStore((s) => s.sessionId)
  const isThinking = useStore((s) => s.isAiThinking)
  const setThinking = useStore((s) => s.setAiThinking)
  const addToast = useStore((s) => s.addToast)

  const [input, setInput] = useState('')
  const messagesRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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

  const send = useCallback(async (overrideMsg?: string) => {
    const msg = overrideMsg || input.trim()
    if (!msg || isThinking) return

    if (!overrideMsg) setInput('')
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: msg,
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
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          terminal_context: getContext(),
          session_id: sessionId,
        }),
      })
      const data = await res.json()

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
  }, [input, isThinking, sessionId, addMessage, updateMessage, setThinking])

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

  return (
    <div className="chat-panel">
      {/* Header */}
      <div className="chat-header">
        <div className="chat-header-left">
          <Sparkles size={14} className="chat-header-icon" />
          <span className="chat-header-title">AI Mentor</span>
        </div>
        <div className="chat-header-right">
          <span className="chat-model-badge">Gemini 3 Flash</span>
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
            <span className="thinking-label">Analyzing...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="chat-input-area">
        <div className="chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="chat-input"
            rows={1}
            placeholder="Ask about Linux..."
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
            disabled={isThinking || !input.trim()}
            title="Send message"
          >
            <Send size={14} />
          </button>
        </div>
        <div className="chat-input-hint">
          Shift+Enter for new line
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
