import { Component, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

type MarkdownViewProps = {
  content: string
}

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  pre: ({ children }) => <pre className="markdown-pre">{children}</pre>,
  code: ({ className, children }) => {
    // 行内代码 vs 围栏代码块：围栏块带 language- 类名
    if (className) {
      return <code className={className}>{children}</code>
    }
    return <code className="markdown-inline-code">{children}</code>
  },
}

function renderMarkdown(content: string): ReactNode {
  return (
    <ReactMarkdown components={components} remarkPlugins={[remarkGfm]}>
      {content}
    </ReactMarkdown>
  )
}

/**
 * 助手消息 Markdown 渲染。react-markdown 默认把未识别 HTML 以纯文本转义显示，
 * 不产生可执行 DOM 节点（XSS 边界）；渲染异常回退纯文本，MUST NOT 显示空白。
 */
export class MarkdownView extends Component<MarkdownViewProps> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return <div className="markdown-plain-fallback">{this.props.content}</div>
    }
    try {
      return <div className="markdown-body">{renderMarkdown(this.props.content)}</div>
    } catch {
      return <div className="markdown-plain-fallback">{this.props.content}</div>
    }
  }
}
