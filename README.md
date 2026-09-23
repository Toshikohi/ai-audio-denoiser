# AI Audio De-Noiser

AI生成楽曲（Suno, Udio 等）特有の高周波ヒスノイズを低減するツールです。  
外部サーバー通信を一切行わず、Web Audio API と STFTによる適応型ウィーナーフィルタリングアルゴリズムにより、ブラウザ単体でノイズ除去とWAV書き出しを実現します。

---

## 主な特徴

- **クライアントサイド完結 (Zero External Runtime Dependencies)**:
  - 音声データの外部送信は行われません。
- **高周波帯域ターゲット型 STFT 適応ウィーナーフィルタ**:
  - Cutoff周波数（例: 6,000Hz〜）以上の高域のみを急峻にターゲット化し、ベースやキック、ボーカル等の中低域にはダメージを与えずにノイズ除去します。
- **原音アタック保護 (Transient Protection)**:
  - スペクトルフラックスを常時追跡し、スネアやハイハットの立ち上がりの瞬間を検知してノイズ除去を瞬間的にバイパスし、楽曲のダイナミクスを保持します。
- **4系統リアルタイムモニタリング**:
  - `Denoised (除去後)` / `Original (原音)` / `Highs Clean (除去後高域)` / `Delta (除去ノイズのみ)` を再生中の同位置でシームレスに切り替え可能。
- **2D 周波数減衰 ＆ アタック保護マップ**:
  - 時間×周波数軸でのノイズ減衰量ヒートマップと、原音アタック保護率を直感的に可視化。
- **WAV エクスポート**:
  - 16-bit PCM / 24-bit PCM / 32-bit Float の書き出しに対応。

---

## プロジェクト構成

```text
ai-audio-denoiser-app/
├── index.html              # SPA エントリHTML
├── package.json            # Vite + TypeScript 構成
├── tsconfig.json           # TypeScript 設定
├── vite.config.ts          # Vite ビルド設定（単一HTMLバンドル・vite-plugin-singlefile）
├── LICENSE                 # MIT License
├── README.md               # 本ドキュメント
└── src/
    ├── main.ts             # アプリケーション初期化・DOMイベント制御
    ├── types.ts            # 全体型定義 (DenoiseParams, Map2DData 等)
    ├── dsp/
    │   ├── fft.ts          # 高速基底2 FFT / IFFT エンジン
    │   ├── denoiser.ts     # STFT適応型ノイズ除去・2Dマップ生成・ISTFT合成
    │   └── wav-exporter.ts # 16/24/32-bit WAV バイナリエンコーダ & エクスポータ
    ├── visualizers/
    │   ├── timeline.ts     # RMS・ノイズフロア時間推移キャンバス
    │   ├── map2d.ts        # 2D減衰ヒートマップ＆アタック保護キャンバス
    │   └── spectrum.ts     # リアルタイム多重周波数スペクトラム
    ├── player/
    │   └── audio-player.ts # Web Audio API 再生エンジン・ホットスワップ制御
    ├── utils/
    │   └── format.ts       # 時間フォーマット等のユーティリティ
    └── styles/
        └── main.css        # UIデザイン（レスポンシブ・グラスモーフィズム・アニメーション）
```

---

## 開発とビルド

### 動作要件
- Node.js: `v18.0.0` 以上 (推奨: Node.js 20+)
- npm: `9.0.0` 以上

### 1. 依存パッケージのインストール
```bash
npm install
```

### 2. 開発サーバーの起動
```bash
npm run dev
```

### 3. 単一HTMLバンドルビルド
```bash
npm run build
```
ビルドを実行すると、`vite-plugin-singlefile` により CSS・JS がすべてインライン化された **単一の自己完結型HTMLファイル（`dist/index.html` 約50KB）** が出力されます。  
外部アセットフォルダへの依存が一切ないため、任意の静的Webサーバーへのデプロイ、GitHub Release への直接添付、またはローカル環境で直接利用可能です。

### 4. ビルド成果物のローカルプレビュー
```bash
npm run preview
```

---

## ライセンス

MIT License (c) 2026 Toshikohi
