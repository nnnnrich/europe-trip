# 歐洲行

離線可用的旅行規劃 PWA：每日行程、機票、交通、住宿、記帳（多幣別＋分帳）、待辦清單。
資料存在手機上，有網路時透過 Supabase 和旅伴同步。

## 部署

1. **Supabase**：建立 project → SQL Editor 貼上 `schema.sql` 執行 → 把 Project URL 和 anon / publishable key 填進 `config.js`
2. **GitHub Pages**：建立 public repo，上傳這個資料夾裡的所有檔案 → Settings → Pages → Branch 選 `main`、資料夾選 `/ (root)` → Save
3. **iPhone**：用 Safari 打開網址 → 分享 → 加入主畫面 → 從主畫面打開 → ⚙︎ 設定 → 建立或加入行程代碼

> 個人資料（訂位代號、座位等）只存在手機和 Supabase，不在這個 repo 裡。
> 行程代碼等同密碼，只傳給旅伴。

## 更新 app

修改檔案後重新上傳，並把 `sw.js` 裡的 `CACHE = 'trip-v1'` 版號加 1，手機下次開啟時就會換成新版。
