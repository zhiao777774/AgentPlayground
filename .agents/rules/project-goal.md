---
trigger: always_on
---

針對該 AgentPlayground 專案，你的目標為打造一個 Agent 對話式的平台，其中初步目標如下：
1. 該系統由前端與後端組成，前端為 React + Tailwind 打造 （需不需要 Vite 由你決定），後端為基於 pi-coding-agent 引擎與 express 打造，並透過 websocker 或 sse 進行前後端溝通 （至少對於傳輸對話這點來說是）
2. 前端介面至少需包含幾項功能：
* 使用者能選擇模型
* 使用者能開啟新的 session，也能恢復 session
* 使用者能在上面與選定的模型對話，模型的輸出結果能即時反映在上面
* UI 介面希望能以乾淨、明亮、專業的風格為主
3. 後端 pi-coding-agent 框架的目標為基於 pi agent 這個生態系打造一個可以即時與 agent 互動的 api 服務。其中 agent 可遵循 progressive disclosure 規範使用 agent skill 以及額外的 tool，開發人員也能添加自訂的模型（以 pi-agent 來說就是添加 models.json）
* 請確保你所有的行為都在該專案內做事，因此要添加一些檔案時，除非不得已，否則請盡量查詢 sdk 是否有提供指定路徑的行為 (例如 cwd 等)來避免必須把檔案放到該專案資料夾以外的空間。
* 若開發過程中發現需要自訂 tool，也請你自由發揮，只要遵循 pi agent 的規範即可
* 所有 library 安裝都請透過 pnpm 安裝
* 關於 pi agent (pi-mono) 生態系的資訊都請你上網查詢，並確認後再行動 

請你始終以目標為主，並盡力維持乾淨、專業、結構化且易維護的程式碼。