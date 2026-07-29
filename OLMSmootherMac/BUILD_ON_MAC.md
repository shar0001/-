# Macでのビルド手順（初心者向け）

このソースコードを、**実際に After Effects で使える Mac 用プラグイン（`.plugin`）**
にするための手順です。**この工程だけは Mac の実機が必要**です。

---

## 用意するもの

1. **Mac**（Apple Silicon / Intel どちらでも可）
2. **Xcode**（App Store から無料。初回は数GBのダウンロード）
3. **Adobe After Effects SDK**（無料・要Adobeアカウント）
   - 入手先: <https://developer.adobe.com/after-effects/> → "Download SDK"
   - お使いの After Effects のバージョンに合った SDK を選ぶ
4. **After Effects 本体**（テスト用）

---

## 手順

### 1. AE SDK を展開する

ダウンロードした SDK を解凍すると、中に `Examples/` フォルダがあります。
`Examples/Template/Skeleton` のような**サンプルプラグインのフォルダ**が、
ビルドの土台になります。

### 2. サンプルの Xcode プロジェクトを複製する

`Examples` 内のサンプル（例: `Skeleton`）フォルダをまるごとコピーして
`OLMSmootherMac` にリネームします。中の `.xcodeproj` を Xcode で開きます。

> こうする理由：AE SDK は「インクルードパス」や「ビルド設定」が独特で、
> ゼロから設定すると難しいため、**動くサンプルの設定を流用する**のが最短です。

### 3. ソースを差し替える

- サンプルの `.cpp` / `.h` を削除し、このリポジトリの
  `src/OLMSmoother.cpp` と `src/OLMSmoother.h` を追加
- サンプルの `*PiPL.r` を、このリポジトリの `OLMSmootherPiPL.r` の内容で置き換え
- Xcode の「Build Phases > Compile Sources」に `OLMSmoother.cpp` が入っていることを確認

### 4. インクルードパスを確認する

Xcode の Build Settings で **Header Search Paths** に、SDK の
`Headers`／`Util` フォルダ（`AE_Effect.h` などがある場所）が
通っているか確認します（サンプルを流用していれば通常はそのままでOK）。

### 5. ビルドする

Xcode で **Product > Build（⌘B）**。成功すると
`~/Library/Developer/Xcode/DerivedData/.../Build/Products/` などに
`OLMSmootherMac.plugin` が生成されます。

### 6. After Effects に入れる

生成された `.plugin` を、AE のプラグインフォルダにコピーします：

```
/Applications/Adobe After Effects <バージョン>/Plug-ins/
```

After Effects を再起動 → メニュー **エフェクト > OLM Plug-ins > OLM Smoother v2**
が出れば成功です。

---

## つまずきやすいポイント

| 症状 | 対処 |
|------|------|
| `AE_Effect.h が見つからない` | Header Search Paths に SDK の Headers を追加 |
| メニューに出ない | `.plugin` の置き場所を確認／AE再起動／PiPLのビルド設定を確認 |
| Apple Silicon で動かない | ターゲットアーキテクチャを arm64（必要なら universal）に |
| 署名の警告 | Xcode の Signing で「Sign to Run Locally」等に設定 |

---

## この工程を私（Claude Code）に手伝わせるには

Mac をご用意できたら、その Mac で Claude Code を動かせば、
**ビルドエラーの解消やアルゴリズムの調整まで私が直接お手伝いできます**。
スマホからでも、コードの修正・追記はこのリポジトリ上で私が続けられます。
