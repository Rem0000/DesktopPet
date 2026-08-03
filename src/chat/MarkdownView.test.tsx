import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownView } from './MarkdownView'

describe('MarkdownView', () => {
  it('渲染标题与列表', () => {
    const html = renderToStaticMarkup(
      <MarkdownView content={'# 标题\n- 项目一\n- 项目二'} />,
    )
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<li>项目一</li>')
    expect(html).toContain('markdown-body')
  })

  it('渲染行内代码与围栏代码块', () => {
    const html = renderToStaticMarkup(
      <MarkdownView content={'`code`\n\n```js\nconst a = 1\n```'} />,
    )
    expect(html).toContain('markdown-inline-code')
    expect(html).toContain('<code class="language-js">')
    expect(html).toContain('markdown-pre')
  })

  it('渲染表格', () => {
    const html = renderToStaticMarkup(
      <MarkdownView content={'| 列1 | 列2 |\n| --- | --- |\n| a | b |'} />,
    )
    expect(html).toContain('<table>')
    expect(html).toContain('<td>a</td>')
  })

  it('链接添加 target=_blank 与 rel=noreferrer', () => {
    const html = renderToStaticMarkup(<MarkdownView content="[官网](https://example.com)" />)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noreferrer"')
  })

  it('原始 HTML 以纯文本转义，不产生可执行 DOM 节点', () => {
    const html = renderToStaticMarkup(
      <MarkdownView content={'<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>'} />,
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    // 标签以转义文本呈现（react-markdown 默认 escape，非 skipHtml 丢弃）
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;img')
  })

  it('空内容渲染空 div', () => {
    const html = renderToStaticMarkup(<MarkdownView content="" />)
    expect(html).toContain('markdown-body')
  })
})
