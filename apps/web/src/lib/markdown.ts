import MarkdownIt from 'markdown-it'

// html: false：敘事是 LLM 產出，不讓內嵌 HTML 直接進頁面。
const md = new MarkdownIt({ html: false })

export function renderMarkdown(text: string): string {
  return md.render(text)
}
