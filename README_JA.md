# OUTPUT WORLD 自動構築システム

ストーリーボード後半3カット

- **06 OUTPUT EMERGENCE** … 青いブロック群が中心から波状に立ち上がる
- **07 DIVE THROUGH OUTPUT** … ブロック群の内部を高速で通り抜ける
- **08 HERO REVEAL** … 上昇後退しながら全景を見せるヒーロー構図

を制作するための、**再実行可能な Blender 自動構築システム**です。

1個の元 Cube を Geometry Nodes でインスタンス化し、青いブロック群からなる巨大な
OUTPUT フィールドを構築します。個別オブジェクトを数百・数千個作ることはありません。

---

## 1. 必要環境

| 項目 | 内容 |
| --- | --- |
| OS | macOS |
| Blender | 3.6 LTS 〜 4.x（4.2 以降の EEVEE Next にも自動対応） |
| レンダーエンジン | EEVEE（4.2+ では EEVEE Next を自動選択） |
| 解像度 / fps | 1920×1080 / 24fps |
| 合成 | After Effects（背景透過 PNG / OpenEXR 連番を出力） |

### Blender のバージョン確認

```bash
/Applications/Blender.app/Contents/MacOS/Blender --version
```

スクリプトは実行時に Blender のバージョンを検出し、そのバージョンに対応した
Python API（Geometry Nodes のソケット定義、EEVEE エンジン名、モーションブラーの
設定場所、Principled BSDF の Emission ソケット名など）へ自動的に切り替えます。

---

## 2. ファイル構成

| ファイル | 役割 |
| --- | --- |
| `build_output_world.py` | メイン。シーン全体を構築し `.blend` を保存、プレビュー静止画を描画 |
| `config.json` | 公開設定値（グリッド数・高さ・Seed など） |
| `render_previews.py` | 保存済み `.blend` からプレビュー／最終レンダーを行う独立スクリプト |
| `README_JA.md` | 本ドキュメント |
| `.gitignore` | `output/` などを除外 |

生成物はすべて `output/` 以下に出力されます。

```
output/
├── output_world.blend          # 構築済みシーン
├── backups/                     # 再実行時の自動バックアップ（コピー）
├── previews/                    # 3カメラのプレビュー静止画（PNG）
└── render/
    ├── shot_06/                 # 最終レンダー連番
    ├── shot_07/
    └── shot_08/
```

---

## 3. ターミナルからの実行方法

`config.json` と同じディレクトリで実行してください。

```bash
cd /path/to/this/folder
BLENDER=/Applications/Blender.app/Contents/MacOS/Blender

# 構築 + プレビュー静止画（960×540, 低サンプル, 背景透過）
"$BLENDER" -b -P build_output_world.py

# 構築のみ（描画をスキップ。GUI で確認したいとき）
"$BLENDER" -b -P build_output_world.py -- --no-render

# 別の設定ファイルを指定
"$BLENDER" -b -P build_output_world.py -- --config my_config.json

# 最終レンダー（1920×1080, MB/DOF ON, 全ショットの連番）
"$BLENDER" -b -P build_output_world.py -- --final

# 特定ショットのみ最終レンダー
"$BLENDER" -b -P build_output_world.py -- --final --shot 08
```

> **補足:** `-b`（バックグラウンド）での EEVEE 描画には GPU が必要です。
> macOS では通常そのまま描画できますが、環境によっては描画に失敗する場合があります。
> その場合は `--no-render` で構築だけ行い、後述の GUI 実行や `render_previews.py`
> で描画してください。

### 保存済み `.blend` から描画（`render_previews.py`）

```bash
# プレビュー静止画のみ
"$BLENDER" -b output/output_world.blend -P render_previews.py

# 最終レンダー
"$BLENDER" -b output/output_world.blend -P render_previews.py -- --final
"$BLENDER" -b output/output_world.blend -P render_previews.py -- --final --shot 07
```

---

## 4. Blender 内 Text Editor からの実行方法

1. Blender を起動する
2. **Scripting** ワークスペース（または Text Editor）を開く
3. **Open** で `build_output_world.py` を開く
4. `config.json` が同じフォルダにあることを確認する
5. **Run Script**（▶）を実行する

構築後、3D ビューポートに `OUTPUT_WORLD` コレクションが生成されます。
タイムライン上のマーカー（`SHOT_06 / SHOT_07 / SHOT_08`）でカメラが切り替わります。
プレビューを描画したいときは、続けて `render_previews.py` を開いて Run Script して
ください（GUI 実行なら EEVEE 描画は問題なく動作します）。

> Text Editor から実行する場合、`--no-render` などの引数は渡せません。
> 既定では構築＋プレビュー描画まで行われます。描画を止めたい場合は
> スクリプト末尾の `main()` を編集するか、ターミナル実行を使ってください。

---

## 5. 設定値の意味（`config.json`）

| キー | 既定値 | 意味 |
| --- | --- | --- |
| `grid_x` | 32 | フィールドの X 方向インスタンス数 |
| `grid_y` | 32 | フィールドの Y 方向インスタンス数（32×32 = 1024 インスタンス） |
| `spacing` | 1.2 | ブロック間隔（ワールド単位）。ブロック幅は間隔の 0.82 倍 |
| `min_height` | 0.5 | ブロックの最低高さ |
| `max_height` | 8.0 | ブロックの最大高さ（Clamp 上限） |
| `noise_scale` | 1.5 | 高さ用ノイズのスケール（大きいほど細かい起伏） |
| `noise_strength` | 2.2 | ノイズによる高さ寄与の強さ |
| `center_peak_strength` | 6.0 | 中央部の山の高さ。中心ほど強く、複数の山ができる |
| `build_start_frame` | 1 | 生成の波が始まるフレーム |
| `build_end_frame` | 32 | 波が外周へ到達し終えるフレーム |
| `red_ratio` | 0.015 | 赤い選択ノードの割合（0.015 = 約1.5%） |
| `random_seed` | 12345 | 乱数シード。**固定なので赤ノードや起伏の位置は毎回同じ** |
| `preview_resolution_percentage` | 50 | プレビュー解像度（1920×1080 の 50% = 960×540） |
| `final_resolution_percentage` | 100 | 最終解像度（100% = 1920×1080） |
| `output_format` | `"PNG"` | 最終出力フォーマット。`"PNG"` または `"OPEN_EXR"` |

### 仕組みの要点

- **高さ** = `min_height + Noise + Random + 中央ピーク` を `max_height` で Clamp。
  中央ピークは「中心からの距離のフォールオフ × 低周波ノイズ」で、
  単純な完全ランダムではなく中心部に複数の山を持つ構造になります。
- **生成の波** は `Scene Time`（フレーム）から Geometry Nodes 内で計算します。
  中心からの距離に応じて各ブロックの立ち上がりフレームをずらし、Smooth Step
  相当（SmootherStep）で 0→最終高さへ補間します。**キーフレーム不要**で、
  どのフレームでも決定論的に同じ結果になります。
- 底面は `z=0` に固定され、Z スケールのみが伸びるため**上方向だけ**に成長します。
- **Realize Instances は不使用**。インスタンス数を増やしても軽量なままです。
- 赤ノードの色分けは、`is_red` 属性をシェーダの `Attribute(Instancer)` で読み、
  1つのマテリアル内でコバルトブルーと赤を切り替えることで実現しています
  （**元 Cube は1個・マテリアルも1つ**）。

---

## 6. パフォーマンス（2段階設定）

| | プレビュー | 最終 |
| --- | --- | --- |
| 解像度 | 960×540（50%） | 1920×1080（100%） |
| サンプル | 16 | 64 |
| モーションブラー | OFF | ON |
| 被写界深度(DOF) | OFF | ON |
| 背景透過 | ON | ON |

- 不要な Subdivision は使用しません。
- ベベルはソース Cube に対する Bevel モジファイア（幅 0.05 / セグメント 2）の
  最小限のみです。
- 個別 Cube オブジェクトは作成しません（GN インスタンスのみ）。

---

## 7. カメラとショット

| カメラ | 焦点距離 | フレーム | 動き |
| --- | --- | --- | --- |
| `OW_CAM_06`（EMERGENCE） | 40mm | 1–32 | 低めの中距離からわずかにドリーイン |
| `OW_CAM_07`（DIVE） | 24mm | 33–64 | ブロック上端より高い高度で内部を高速移動（衝突回避）、手前のパララックス強、最終のみ MB |
| `OW_CAM_08`（HERO） | 50mm | 65–96 | 上昇しながら後退し、最終フレームでヒーロー構図 |

タイムラインのマーカーでカメラが自動切替されるため、`--final` で全体を描画すると
各ショットが正しいカメラでレンダリングされます。`--shot 06/07/08` で個別に描画も
可能です。

---

## 8. 安全性・再実行性

- 何度実行しても重複オブジェクトは増えません。専用コレクション `OUTPUT_WORLD` と
  `OW_` 接頭辞のデータブロックだけを破棄・再生成します。
- **ユーザーの他のコレクション・データには一切触れません。**
- 処理前に、既存の `output/output_world.blend` を `output/backups/` へ
  **コピー**してバックアップします（**ファイル削除は一切行いません**）。
- エラー時は原因を明確にログ表示し、スタックトレースを出力します。
- 可能な限り `bpy.ops` ではなく Blender Data API を使用しています
  （例外はレンダリングとファイル保存のみ）。

---

## 9. エラー時の確認方法

| 症状 | 確認・対処 |
| --- | --- |
| `config.json が見つかりません` | スクリプトと同じフォルダに `config.json` があるか確認。`-- --config パス` で明示指定も可 |
| プレビュー描画に失敗（ヘッドレス） | `-b` の EEVEE 描画には GPU が必要。GUI で `render_previews.py` を実行するか、`--no-render` で構築だけ行う |
| ブロックが立ち上がらない | フレームが `build_end_frame` 以降か確認。フレーム 32 以降は全ブロックが完成状態 |
| 赤ノードが見えない | `red_ratio` が小さい（既定 1.5%）。値を上げると増える。位置は Seed 固定で不変 |
| ソース Cube が中央に見える | ビューポート表示のみ。`hide_render=True` のため描画には出ません |
| 全体が暗い／明るすぎる | `build_lighting()` の Key/Fill の `energy`、World の `Strength` を調整 |
| ログの確認 | すべてのログは `[OUTPUT_WORLD]` / `[RENDER_PREVIEWS]` 接頭辞付きでコンソールに出力されます。ターミナル実行なら標準出力を確認 |

エラーが出た場合は、ログ末尾の `[ERROR]` 行とスタックトレースに原因が表示されます。

---

## 10. After Effects への取り込み

- 出力は背景透過（`film_transparent = True` / RGBA）です。
- `output_format` を `"PNG"` にすると PNG 連番、`"OPEN_EXR"` にすると 16bit half
  の OpenEXR 連番（ZIP 圧縮）を出力します。EXR は AE でのグレーディング耐性が
  高いので、本番合成では EXR を推奨します。
- 各ショットは `output/render/shot_06 | shot_07 | shot_08` に分かれて出力されるため、
  AE 上でショットごとにフッテージとして読み込めます。
