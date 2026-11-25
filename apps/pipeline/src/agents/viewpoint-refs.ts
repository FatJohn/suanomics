// 論點的詳解段落號要能機械驗證：對不到現有段落的一律改標整體性論點（null），不丟論點，
// 丟了會讓 support／risk 掉到 2 點以下、整個區塊 degrade。
export function resolveSectionRef(raw: number | null, sectionCount: number): number | null {
  return raw !== null && Number.isInteger(raw) && raw >= 1 && raw <= sectionCount ? raw : null
}
