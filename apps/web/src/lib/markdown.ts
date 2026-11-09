import MarkdownIt from 'markdown-it'

// 只開段落與粗斜體。compliance 過濾的是 markdown 原文，連結與 entity 會在渲染後才拼出
// 禁用語，連結與圖片也會帶出非 http(s) 的 href 或第三方請求，所以敘事一律不解析它們。
const md = new MarkdownIt('zero', { html: false }).enable(['emphasis'])

export function renderMarkdown(text: string): string {
  return md.render(text)
}
