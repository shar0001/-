# After Effects ジェネラティブ・ドットアニメーション

極座標グリッド上のドット群が、`State`（状態）の切り替えに合わせて
位置・サイズ・色を滑らかに変化させるモーショングラフィックスを、
After Effects 上にワンクリックで生成する ExtendScript です。

## 収録スクリプト

| ファイル | 状態数 | 特徴 |
|---|---|---|
| `PolarDots.jsx` | 5 | RANDOM→SIMPLICITY→SPACE→IMPERFECT→VIVID |
| `DotPrinciples.jsx` | 6 | 上記に **EMERGE（発生/消散）** と **SPACE対称型（最外周の対称点）** を追加した発展版 |

---

## PolarDots.jsx

## 状態シーケンス

| State | 名前 | 挙動 |
|------:|------|------|
| 0 | **RANDOM** | 円内にランダム配置・極小・黒 |
| 1 | **SIMPLICITY** | 同心円グリッドに整列・均一サイズ・黒 |
| 2 | **SPACE** | 一部のドットだけが拡大（対象が時間で移り変わる） |
| 3 | **IMPERFECT** | 中層の1リングだけが一斉に拡大 |
| 4 | **VIVID** | マルチカラー＋ノイズでサイズが明滅 |

## 使い方

1. After Effects を起動
2. `File > Scripts > Run Script File...` から `PolarDots.jsx` を選択
   - パネル常駐させたい場合は ScriptUI Panels フォルダに入れて
     `Window` メニューから開き、`Generate PolarDots` ボタンを押す
3. `PolarDots` コンポが生成され、`DOT_CTRL` の `State` スライダーが
   `0 → 4` にキーフレームされた状態で開きます
4. RAM プレビューで全シーケンスを確認

## 調整

- `PolarDots.jsx` 冒頭の `CONFIG` を書き換えるだけで、ドット数・
  リング数・間隔・色パレット・サイズ・コンポ設定を変更できます。
- 生成後は `DOT_CTRL` の `State` スライダーのキーフレームを動かすだけで
  演出のタイミングを自由に編集できます（整数値 0〜4 の間を補間）。

## しくみ

- **コントローラー方式**: `DOT_CTRL` Null の `State` スライダー1本で全体を制御。
- **エクスプレッション駆動**: 各ドットの位置（極座標グリッド）・スケール・色を
  自身の index から計算。状態間は `ease()` / `linear()` で補間。
- **時間変化**: SPACE の「動く選択」、IMPERFECT のリング移動、VIVID のノイズ明滅は
  すべて `time` から自動生成されるため、キーフレーム不要で有機的に動きます。

---

## DotPrinciples.jsx（発展版）

`PolarDots.jsx` をベースに、参考画像をもとして次の2状態を追加した6状態版です。

| State | 名前 | 挙動 |
|------:|------|------|
| 0 | **EMERGE** | ほぼ全消し、数個だけ可視（発生/消散）|
| 1 | **RANDOM** | 円内ランダム配置・極小・黒 |
| 2 | **SIMPLICITY** | 同心円グリッドに整列・均一・黒 |
| 3 | **SPACE** | 最外周の対称点（ゆっくり回転）＋散財する数個だけ拡大 |
| 4 | **IMPERFECT** | 中層の1リングだけが一斉に拡大 |
| 5 | **VIVID** | マルチカラー＋ノイズでサイズが明滅 |

使い方・調整方法は `PolarDots.jsx` と同じ（`State` は 0〜5）。
`CONFIG` で対称点の数 `spaceSymCount`・回転速度 `spaceSymSpeed`・
EMERGE で残す割合 `emergeKeepRatio` などを調整できます。
