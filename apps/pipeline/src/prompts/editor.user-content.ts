// editor agent（`apps/server/src/agents/editor.ts`）送給 LLM 的 user content 文字。
// 放這裡是為了跟 system prompt 一樣，換語言／市場時能整份替換，不必進 runner 邏輯裡挖字面值。
export const EDITOR_USER_TEXT = {
  candidatesHeading: (count: number) => `## 候選新聞（${count} 則、只能從這些 id 中選）`,
  storylinesHeading: (count: number) => `## 進行中敘事線（${count} 條）`,
  noStorylines: '（目前無、可視今日新聞提出 0-2 條新線）',
  noStorylineArc: '（尚無進展）',
  storylineLine: (id: number, title: string, thesis: string, arc: string) => `[${id}] ${title}｜論點：${thesis}｜近期：${arc}`,
  recentBriefsHeading: '## 近三日 brief',
  noRecentBriefs: '（無）',
  calendarHeading: '## 本週財經行事曆（判斷今日是否排定總經事件）',
  marketSnapshotHeading: '## 市場數據快照（判斷市場是否大幅變動）',
  officialHeading: '## 主管機關公告（一手消息、判斷今日是否有政策事件）',
  officialNote: '★ 這是背景素材，**不保證出現在候選新聞清單裡**；只有清單裡真的存在的 id 才可寫進 selectedNewsIds。無論有沒有選到，都要把這裡的內容納入主軸與 dailyThesis 的判斷。',
}
