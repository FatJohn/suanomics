/**
 * 剝掉區塊註解（`/star ... star/` 形式）與 `//` 行註解之後的內容。共用於 gemini-only-paths.test.ts
 * 與 llm-chokepoint.ts——兩者都需要「掃描原始碼但忽略註解裡提到的東西」，各自的
 * specifier 判準不同（見各自檔案的說明），但剝註解這一步完全一樣，抽出來避免兩份
 * 副本各自改一次、各自漏一次。
 *
 * 已知取捨：`//` 一律截到行尾，所以字串裡的 `https://…` 也會被截斷。要因此漏判，得寫出
 * 「specifier 出現在同一行某個 `//` 之後、而那個 `//` 又在字串裡」的程式碼——例如從 CDN
 * 網址 import。這個 repo 不那樣 import，接受。
 */
export function stripComments(content: string): string {
  const withoutBlocks = content.replace(/\/\*[\s\S]*?\*\//g, '')
  return withoutBlocks
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//')
      return i < 0 ? line : line.slice(0, i)
    })
    .join('\n')
}
