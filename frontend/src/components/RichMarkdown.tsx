import { useRef, useState, useCallback } from 'react'
import { Marked } from 'marked'
import { markedHighlight } from 'marked-highlight'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import python from 'highlight.js/lib/languages/python'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import yaml from 'highlight.js/lib/languages/yaml'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import diff from 'highlight.js/lib/languages/diff'
import sql from 'highlight.js/lib/languages/sql'
import ini from 'highlight.js/lib/languages/ini'
import xml from 'highlight.js/lib/languages/xml'
import './RichMarkdown.css'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)
hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('diff', diff)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('ini', ini)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)

const marked = new Marked(
  markedHighlight({
    langPrefix: 'hljs language-',
    highlight(code: string, lang: string) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value
      }
      return hljs.highlightAuto(code, ['bash', 'python', 'javascript', 'json']).value
    },
  })
)

const renderer = new marked.Renderer()
const origBlockquote = renderer.blockquote
renderer.blockquote = function (token: any) {
  const text = typeof token === 'string' ? token : (token?.text ?? token?.body ?? '')
  // Callout detection without emojis — use text markers
  const calloutMatch = text.match(/^<p>(WARNING|SAFE|UNSAFE|TIP|NOTE|INFO)[:\s]*/i)
  if (calloutMatch) {
    const type = calloutMatch[1].toLowerCase()
    const body = text.replace(calloutMatch[0], '<p>')
    const typeClass =
      type === 'warning' ? 'callout-warning' :
      type === 'unsafe' ? 'callout-danger' :
      type === 'safe' ? 'callout-success' :
      type === 'tip' ? 'callout-tip' : 'callout-info'
    const iconSvg =
      type === 'warning' || type === 'unsafe'
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>'
        : type === 'safe' || type === 'success'
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
        : type === 'tip'
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>'
    return `<div class="callout ${typeClass}"><span class="callout-icon">${iconSvg}</span><div class="callout-body">${body}</div></div>`
  }
  if (typeof origBlockquote === 'function') {
    return origBlockquote.call(this, token)
  }
  return `<blockquote>${text}</blockquote>`
}

marked.use({ renderer })

function parseMarkdown(text: string): string {
  let processed = text
    .replace(/^:::collapse\s+(.+)$/gm, '<details><summary>$1</summary>\n')
    .replace(/^:::$/gm, '</details>')

  return marked.parse(processed) as string
}

interface Props {
  content: string
  onRunCommand?: (cmd: string) => void
  onExplain?: (text: string) => void
}

export function RichMarkdown({ content, onRunCommand, onExplain }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const handleCopy = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }, [])

  const html = parseMarkdown(content)

  const handleRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    el.querySelectorAll('pre code').forEach((codeEl, i) => {
      const pre = codeEl.parentElement
      if (!pre || pre.querySelector('.code-actions')) return

      const code = codeEl.textContent || ''
      const blockId = `code-${i}`

      const actions = document.createElement('div')
      actions.className = 'code-actions'

      // Copy button — no emoji
      const copyBtn = document.createElement('button')
      copyBtn.className = 'code-action-btn'
      copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span>Copy</span>'
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(code)
        copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg><span>Copied</span>'
        copyBtn.classList.add('copied')
        setTimeout(() => {
          copyBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg><span>Copy</span>'
          copyBtn.classList.remove('copied')
        }, 1500)
      }
      actions.appendChild(copyBtn)

      // Detect bash command
      const lines = code.trim().split('\n')
      const isBashCommand = lines.length <= 3 &&
        (pre.querySelector('.language-bash, .language-sh, .language-shell') || 
         /^(sudo |apt |cd |ls |mkdir |rm |chmod |chown |cat |echo |grep |find |tar |curl |wget |git |pip |npm |docker |systemctl |man )/m.test(code.trim()))

      if (isBashCommand && onRunCommand) {
        const runBtn = document.createElement('button')
        runBtn.className = 'code-action-btn code-action-run'
        runBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg><span>Run</span>'
        runBtn.onclick = () => onRunCommand(code.trim())
        actions.appendChild(runBtn)
      }

      // Explain button
      if (onExplain) {
        const explainBtn = document.createElement('button')
        explainBtn.className = 'code-action-btn code-action-explain'
        explainBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg><span>Explain</span>'
        explainBtn.onclick = () => onExplain(code.trim())
        actions.appendChild(explainBtn)
      }

      // Language tag
      const langClass = codeEl.className.match(/language-(\w+)/)
      if (langClass) {
        const langTag = document.createElement('span')
        langTag.className = 'code-lang-tag'
        langTag.textContent = langClass[1]
        actions.appendChild(langTag)
      }

      pre.style.position = 'relative'
      pre.appendChild(actions)
    })
  }, [onRunCommand, onExplain])

  return (
    <div
      className="rich-markdown"
      ref={handleRef}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
