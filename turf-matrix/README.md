# TURF MATRIX

**AI Racing Intelligence Platform** — 競馬を、もっとクリアに。
人気ではなく、期待値でレースを読む競馬AI分析サービス(β)。

## デプロイ(GitHub → Vercel)

1. このフォルダをGitHubリポジトリとしてpush
   ```bash
   git init && git add -A && git commit -m "TURF MATRIX β"
   git remote add origin <あなたのリポジトリURL> && git push -u origin main
   ```
2. [Vercel](https://vercel.com) で **Add New → Project** → リポジトリを選択
3. Framework Preset は **Vite** が自動検出されます(Build: `npm run build` / Output: `dist`)。そのまま **Deploy**

## ローカル開発

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # 本番ビルド(dist/)
```

## 毎週のデータ更新

サイト本体(`src/App.jsx`)は触らず、データだけを差し替えます:

```bash
# 1. TARGETからCSVを出力し、tools/ の設定で変換(詳細は docs/OPERATIONS.md)
node tools/csv-to-week.mjs --config <csv-config.json> --out tools/week-data.json
# 2. 検証つきでサイトへ注入
npm run update-data
# 3. commit & push → Vercelが自動デプロイ
```

運営マニュアル全文: [docs/OPERATIONS.md](docs/OPERATIONS.md)

## 構成

```
src/App.jsx        サイト本体(UI + ロジック + 週次データ) — 単一ファイル
tools/             週次更新パイプライン(CSV→JSON→注入、検証・ログ付き)
docs/OPERATIONS.md 運営マニュアル
public/            ロゴ・favicon(ブランドアセット)
```
