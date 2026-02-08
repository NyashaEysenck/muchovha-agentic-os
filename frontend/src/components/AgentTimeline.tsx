import { useRef, useEffect, useState, memo } from 'react'
import { useStore, type AgentEvent } from '../store'
import {
  Brain, Wrench, CheckCircle, AlertCircle, Cpu, Loader2,
  Paperclip, Volume2,
} from 'lucide-react'
import { Marked } from 'marked'
import hljs from 'highlight.js'
import { markedHighlight } from 'marked-highlight'
import 'highlight.js/styles/github-dark.css'
import './AgentTimeline.css'

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value
      return hljs.highlightAuto(code).value
    },
  })
)

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
}

export function AgentTimeline() {
  const events = useStore((s) => s.agentEvents)
  const isRunning = useStore((s) => s.isAgentRunning)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight
  }, [events])

  return (
    <div className="timeline-panel">
      <div className="timeline-header">
        <span className="tile-label">Agent Activity</span>
        {isRunning && <span className="timeline-live"><span className="live-dot" /> Live</span>}
      </div>
      <div className="timeline-scroll" ref={containerRef}>
        {events.length === 0 ? (
          <div className="timeline-empty">
            <Cpu size={24} strokeWidth={1.5} />
            <span>No activity yet</span>
            <span className="timeline-empty-sub">Agent actions will appear here as a timeline</span>
          </div>
        ) : (
          <div className="timeline-track">
            {events.map((ev, i) => (
              <TimelineNode key={ev.id} event={ev} isLast={i === events.length - 1} />
            ))}
            {isRunning && (
              <div className="timeline-node timeline-node-active">
                <div className="timeline-connector" />
                <div className="timeline-dot dot-working"><Loader2 size={10} className="spin" /></div>
                <div className="timeline-content">
                  <span className="tl-working">Working...</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const TimelineNode = memo(function TimelineNode({ event, isLast }: { event: AgentEvent; isLast: boolean }) {
  const { type, data } = event
  const [expanded, setExpanded] = useState(true)

  if (type === 'text' && data.role === 'user') {
    return (
      <div className="timeline-node">
        {!isLast && <div className="timeline-connector" />}
        <div className="timeline-dot dot-user"><Brain size={9} /></div>
        <div className="timeline-content tl-user">
          <span className="tl-label">User</span>
          <span className="tl-text">{data.text}</span>
          {data.attachments && (
            <div className="tl-attachments">
              {data.attachments.map((att: any, i: number) => (
                <span key={i} className="tl-attachment-chip">
                  {att.previewUrl ? (
                    <img src={att.previewUrl} alt={att.name} className="tl-thumb" />
                  ) : att.mime_type?.startsWith('audio/') ? (
                    <><Volume2 size={10} /> {att.name}</>
                  ) : (
                    <><Paperclip size={10} /> {att.name}</>
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
      <div className="timeline-node">
        {!isLast && <div className="timeline-connector" />}
        <div className="timeline-dot dot-response"><Cpu size={9} /></div>
        <div className="timeline-content tl-response">
          <span className="tl-label">Agent Response</span>
          <div className="tl-markdown markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    )
  }

  if (type === 'tool_call') {
    return (
      <div className="timeline-node">
        {!isLast && <div className="timeline-connector" />}
        <div className="timeline-dot dot-tool"><Wrench size={9} /></div>
        <div className="timeline-content tl-tool">
          <span className="tl-label">Tool Call</span>
          <code className="tl-tool-name">{data.tool}</code>
          <code className="tl-tool-args">{JSON.stringify(data.args, null, 0)}</code>
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
    const truncated = typeof resultText === 'string' && resultText.length > 500
    return (
      <div className="timeline-node">
        {!isLast && <div className="timeline-connector" />}
        <div className="timeline-dot dot-result"><CheckCircle size={9} /></div>
        <div className="timeline-content tl-result" onClick={() => setExpanded(v => !v)}>
          <span className="tl-label">Result <span className="tl-expand">{expanded ? '▾' : '▸'}</span></span>
          {expanded && <pre className="tl-output">{truncated ? resultText.slice(0, 500) + '...' : resultText}</pre>}
        </div>
      </div>
    )
  }

  if (type === 'thought') {
    return (
      <div className="timeline-node">
        {!isLast && <div className="timeline-connector" />}
        <div className="timeline-dot dot-thought"><Brain size={9} /></div>
        <div className="timeline-content tl-thought" onClick={() => setExpanded(v => !v)}>
          <span className="tl-label">Thinking <span className="tl-expand">{expanded ? '▾' : '▸'}</span></span>
          {expanded && <span className="tl-thought-text">{data.text}</span>}
        </div>
      </div>
    )
  }

  if (type === 'error') {
    return (
      <div className="timeline-node">
        {!isLast && <div className="timeline-connector" />}
        <div className="timeline-dot dot-error"><AlertCircle size={9} /></div>
        <div className="timeline-content tl-error">
          <span className="tl-label">Error</span>
          <span className="tl-text">{data.error}</span>
        </div>
      </div>
    )
  }

  if (type === 'status') {
    return (
      <div className="timeline-node">
        {!isLast && <div className="timeline-connector" />}
        <div className="timeline-dot dot-status"><Loader2 size={9} /></div>
        <div className="timeline-content">
          <span className="tl-status">{data.status}</span>
        </div>
      </div>
    )
  }

  return null
})
