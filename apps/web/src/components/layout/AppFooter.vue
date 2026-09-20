<script setup lang="ts">
import { TOTAL_MONITORED_SOURCES } from '@/lib/monitored-sources.js'
</script>

<template>
  <footer class="app-footer">
    <div class="app-footer-inner">
      <p class="footer-links">
        <RouterLink to="/sources" class="footer-link">
          監測來源 {{ TOTAL_MONITORED_SOURCES }} 個頻道
        </RouterLink>
      </p>

      <!-- 整句寫成一行：在標籤裡斷行會被 HTML 摺成一個看得見的空格，中文句子之間就多一個洞
           （即使斷在「。」之後也一樣）。這兩段從 main 帶過來時就有這個問題，一併修掉。 -->
      <div class="footer-legal">
        <p>
          <b>本網站不提供投資建議</b>、所有內容僅供參考、不構成任何買進、賣出或持有之推薦。依《證券投資信託及顧問法》第 4 條、本服務非從事證券投資顧問業務。
        </p>
        <p>
          使用者與金融機構若生消費爭議、得依《金融消費者保護法》向金融消費評議中心申請評議。歷史績效不代表未來表現、投資人應審慎評估。
        </p>
        <div class="footer-meta">
          <span>© 2026 JohnShu</span>
          <span>·</span>
          <span>市場數據：FRED、TWSE、TAIFEX、Nasdaq</span>
        </div>
      </div>
    </div>
  </footer>
</template>

<style scoped>
/* footer 只做兩件事：指向監測來源那一頁，以及法律聲明。
   2026-08-02 之前它還有兩塊：上方「信任兩格」（產品承諾）與中間的 30 個 chip 牆。
   兩塊都移走了——承諾在讀者面已經有更硬的證據（佐證層那份「報告用到的來源」與每段引用），
   chip 牆佔掉 footer 一半高度（276／473 of 566／908）而讀者每天捲到底都要付這個高度，
   它現在住在 /sources、那裡放得下分類與抓取方式的說明。 */
.app-footer {
  border-top: 1px solid var(--border);
  margin-top: 80px;
}

/* 播放器在場時讓出它的高度。它是 fixed、不佔流，而 footer 是文件的最後一段——
   不讓位的話最後一行會被蓋掉（見 main.css 的 --dock-reserve 註解）。
   用 :has() 而不是無條件留白，是因為播放器只在首頁；工具頁沒有它、不該多一段死空白。 */
.app-shell:has(.dock) .app-footer {
  padding-bottom: var(--dock-reserve);
}

.app-footer-inner {
  max-width: var(--measure-frame);
  margin: 0 auto;
  padding: 28px var(--frame-pad) 36px;
}

.footer-links {
  margin: 0 0 20px;
  font-size: var(--size-small);
}

.footer-link {
  color: var(--accent);
  text-decoration: none;
}

.footer-link:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.footer-legal p {
  margin: 0 0 10px;
  font-size: var(--size-caption);
  line-height: 1.75;
  color: var(--fg-muted);
}

.footer-meta {
  margin-top: 16px;
  display: flex;
  gap: 8px;
  font-family: var(--font-num);
  font-size: var(--size-caption);
  color: var(--fg-muted);
}

@media (max-width: 720px) {
  .app-footer-inner {
    padding: 22px var(--frame-pad) 28px;
  }
}

@media (max-width: 480px) {
  .footer-meta {
    flex-direction: column;
    gap: 4px;
  }
  .footer-meta span:nth-child(2) {
    display: none;
  }
}
</style>
