# OLM Smoother (Mac版クローン) — `OLMSmootherMac`

Windows専用の After Effects プラグイン **OLM Smoother v2**（`.aex`）を、
**機能とUIそのままに Mac（`.plugin`）で動かす**ことを目的とした、
After Effects SDK 用の C++ プラグインです。

> ⚠️ **正直な現状（必ず読んでください）**
> このフォルダにあるのは **ソースコード（レシピ）** です。
> これを実際に Mac で動くプラグインにするには、**Mac + Xcode + Adobe After Effects SDK**
> で「ビルド（コンパイル）」する工程が必要です。スマホや Windows だけでは
> 最終ファイルは作れません（詳細は [`BUILD_ON_MAC.md`](./BUILD_ON_MAC.md)）。

---

## これは何をするプラグイン？

OLM Smoother は、アニメのセル画などに出る**ジャギー（ギザギザの線）を、
ボカさずに滑らかにする**ための After Effects エフェクトです。
オリジナルは OLM Digital, Inc. が Apache License 2.0 で公開しています。

このリポジトリの `OLMSmootherMac` は、公式のソースコードが入手できない状況で、
**公式マニュアルに記載された仕様だけを頼りに、ゼロから書き起こした
クリーンルーム実装**です（オリジナルのバイナリは逆コンパイルしていません）。
そのため UI とパラメータは公式と同一に揃えていますが、
**出力を1ピクセル単位までオリジナルと完全一致させることは保証しません**。
ここは Mac でビルド後、実際の映像で見比べながら調整していく前提です。

## UI（エフェクトコントロール）

オリジナル `.aex` から抽出した実際のパラメータと**同じ並び・同じ名前**で実装しています。

| # | パラメータ | 種類 | 役割 |
|---|-----------|------|------|
| 1 | **Enable Color Key** | チェック | 指定色を透過させる（下レイヤーが見える） |
| 2 | **Color Key** | カラー | 抜く色 |
| 3 | **Invert Color Key** | チェック | 抜く/残すを反転 |
| 4 | **Smoothness** | スライダー 0–100 | スムージングの強さ（0=無し, 100=通常） |
| 5 | **Extra Smooth** | チェック | さらに滑らかな線を出す |
| 6 | **Smoother Version** | ポップアップ v1/v2 | ガンマ処理の挙動を v1/v2 で切替 |
| 7 | **Smooth Range** | スライダー 0–255 | 「同じ色」とみなす色差の許容量 |
| 8 | **Gamma Correction** | ポップアップ | None / Gamma Colors / All Colors |
| 9 | **Gamma Value** | スライダー | ガンマ値（既定 2.4） |
| 10 | **Number of Gamma Colors** | スライダー | ガンマを効かせる色の数 |
| 11 | **Gamma Color** | カラー | ガンマ対象の色（Gamma Colors モード時） |

## フォルダ構成

```
OLMSmootherMac/
├── README.md              ← このファイル
├── BUILD_ON_MAC.md        ← Macでのビルド手順（初心者向け・最重要）
├── src/
│   ├── OLMSmoother.h      ← パラメータ定義・共通ヘッダ
│   └── OLMSmoother.cpp    ← プラグイン本体（UI＋画像処理）
└── OLMSmootherPiPL.r      ← AEにプラグインを認識させるリソース定義
```

## 進め方（ロードマップ）

- [x] **STEP 1**：UI（パラメータ）を公式と同一に定義 ← 完了
- [x] **STEP 2**：画像処理コア（スムージング/ガンマ/カラーキー）の初版 ← 完了
- [ ] **STEP 3**：Mac + Xcode + AE SDK でビルド（← あなたの Mac が必要）
- [ ] **STEP 4**：実映像でオリジナルと見比べ、アルゴリズムを微調整
- [ ] **STEP 5**：32bit/MFR 対応の詰め、配布形態の検討

## ライセンス

オリジナル OLM Smoother は Apache License 2.0（Copyright OLM Digital, Inc.）。
本クローンも同ライセンスに従います。ルートの `LICENSE` を参照してください。
"OLM" は OLM Digital, Inc. の名称です。配布する場合は商標・帰属表示にご注意ください。
