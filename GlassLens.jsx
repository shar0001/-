/**********************************************************************
 * GlassLens.jsx  v1.1
 * --------------------------------------------------------------------
 * シェイプレイヤー1枚を「ガラスのレンズ」にする After Effects スクリプト。
 * 参考: 2D SDF Shape で背景を屈折させるガラス表現
 *       （縁に向かって強く屈折 / 縁に沿って縞が圧縮 / 色収差 / 細いリム）
 *
 * ■ 一つのシェイプで完結
 *   - 選択したシェイプレイヤー（＝マスター）にボタン1つで適用。
 *   - 調整はすべてマスターのエフェクトコントロール（GL ～）で行う。
 *     スライダーはすべて 0〜100 の範囲でドラッグ操作できる値にしてある。
 *   - 生成される補助レイヤーはシャイ＋ロック。触る必要なし。
 *
 * ■ モーション・モーフィングで崩れない
 *   - 補助レイヤーはマスターの「コンテンツの全プロパティ」と「トランスフォーム」に
 *     エクスプレッションでリンク。パスのキーフレーム（モーフィング）、
 *     楕円/長方形のサイズ・角丸、グループのトランスフォーム、レイヤーの移動・
 *     回転・スケール・親子付けにすべて追従する。
 *   - エッジ幅と屈折量は「シェイプの大きさに対する%」で毎フレーム計算するため、
 *     シェイプを拡大縮小・モーフィングしても質感が保たれる。
 *   - シェイプのグループを追加・削除した（構造が変わった）ときだけ [再構築] を押す。
 *
 * ■ 仕組み（2D SDF 的なハイトマップ → 法線 → 変位）
 *   GL_H_<名前>   : マスターのリンク複製を白で塗り → Fast Box Blur
 *                   ＝縁で0→内側で1になる高さマップ（SDFを滑らかにしたもの）
 *   GL_MAP_<名前> : 高さマップを ±e ずらして 加算/減算 → 勾配（法線）を
 *                   R=横, G=縦 に格納した変位マップ（中立=50%グレー）
 *   メインコンプ   : 調整レイヤーで ぼかし → 拡大(Transform) → Displacement Map。
 *                   赤/青だけ少しずらして Lighten → 色収差。
 *                   マスターのアルファでマット → シェイプの内側だけに効く。
 *
 * ■ レイヤー構成（メインコンプ、上から）
 *   <マスター>                 … 操作するのはこれだけ（マットとして非表示になる）
 *   GL Rim Inner / GL Rim      … 縁のハイライト
 *   GL Disp B / GL Disp R      … 色収差
 *   GL Lens                    … 屈折本体
 *   GL Map                     … 変位マップ（非表示）＋自動計算値
 *   （各レイヤー名の末尾に " - <マスター名>" が付く）
 *
 * ■ 動作環境: After Effects 2023 (v23) 以降を推奨
 *   （トラックマットのレイヤー指定 API を使用。旧バージョンでは
 *     マット用の複製レイヤーを自動で挟むフォールバックで動作）
 *
 * ※ AE は「エフェクトやシェイプ要素を追加/削除すると、同じレイヤーの
 *    以前に取得したプロパティ参照が無効になる」ため、本スクリプトでは
 *    追加/削除のたびにレイヤーから取り直している。
 * ※ UI の日本語はエンコーディング差で化けないよう \u エスケープで記述。
 **********************************************************************/

(function GlassLens(thisObj) {

    // =================================================================
    // CONFIG
    // =================================================================
    var CONFIG = {
        folderName: "GlassLens Rigs",

        // スライダー初期値（すべて 0〜100 のドラッグ範囲内）
        refraction:  50,    // 屈折の強さ。50 = エッジ幅と同じ距離だけずれる
        edgeWidth:   50,    // 屈折が起きる縁の幅（シェイプ半径に対する%）
        magnify:     5,     // 内側の拡大（+%）
        dispersion:  5,     // 色収差（屈折に対する%）。0 で無効
        frost:       0,     // すりガラスぼかし(px)
        rimOpacity:  50,    // 縁ハイライトの不透明度(%)
        rimWidth:    2,     // 縁ハイライトの幅(px)
        invert:      0,     // 1 = 屈折の向きを反転（凹レンズ）

        // 内部係数
        erodeK: 0.05,       // 高さマップの収縮（エッジ幅比）
        blurK:  0.33,       // 高さマップのぼかし半径（エッジ幅比）
        gradK:  0.33        // 勾配を取るときのずらし量（エッジ幅比）
    };

    // プリセット（UI のドロップダウン）
    var PRESETS = [
        { label: "\u6a19\u6e96 (Default)",       v: { refraction: 50, edgeWidth: 50, magnify: 5,  dispersion: 5, frost: 0, rimOpacity: 50, rimWidth: 2, invert: 0 } },
        { label: "\u7403\u4f53 (Sphere)",        v: { refraction: 60, edgeWidth: 85, magnify: 10, dispersion: 6, frost: 0, rimOpacity: 60, rimWidth: 2, invert: 0 } },
        { label: "\u30ac\u30e9\u30b9\u677f (Glass panel)", v: { refraction: 45, edgeWidth: 20, magnify: 0,  dispersion: 4, frost: 0, rimOpacity: 70, rimWidth: 2, invert: 0 } },
        { label: "\u6c34\u6ef4 (Droplet)",       v: { refraction: 75, edgeWidth: 60, magnify: 15, dispersion: 8, frost: 0, rimOpacity: 40, rimWidth: 1, invert: 0 } },
        { label: "\u3059\u308a\u30ac\u30e9\u30b9 (Frosted)", v: { refraction: 40, edgeWidth: 40, magnify: 0,  dispersion: 3, frost: 12, rimOpacity: 60, rimWidth: 2, invert: 0 } },
        { label: "\u51f9\u30ec\u30f3\u30ba (Concave)", v: { refraction: 50, edgeWidth: 70, magnify: 0,  dispersion: 5, frost: 0, rimOpacity: 50, rimWidth: 2, invert: 1 } }
    ];

    var CTRL = {
        refraction: "GL Refraction",
        edgeWidth:  "GL Edge Width %",
        magnify:    "GL Magnify +%",
        dispersion: "GL Dispersion",
        frost:      "GL Frost Blur",
        rimOpacity: "GL Rim Opacity",
        rimWidth:   "GL Rim Width",
        invert:     "GL Invert (Concave)"
    };
    var CTRL_ORDER = ["refraction", "edgeWidth", "magnify", "dispersion", "frost", "rimOpacity", "rimWidth", "invert"];
    var CTRL_CHECKBOX = { invert: true };

    var TAG_MASTER = "GLASSLENS_MASTER:";
    var TAG_RIG    = "GLASSLENS_RIG:";

    // UI 文言（日本語は \u エスケープ）
    var T = {
        title:     "GlassLens v1.1",
        apply:     "\u9069\u7528  (Apply)",
        rebuild:   "\u518d\u69cb\u7bc9  (Rebuild)",
        remove:    "\u89e3\u9664  (Remove)",
        presetLbl: "\u30d7\u30ea\u30bb\u30c3\u30c8:",
        presetBtn: "\u9069\u7528",
        bpc:       "\u9069\u7528\u6642\u306b 16bpc \u306b\u4e0a\u3052\u308b (\u6ed1\u3089\u304b)",
        toggle:    "\u88dc\u52a9\u30ec\u30a4\u30e4\u30fc\u8868\u793a/\u975e\u8868\u793a",
        help:      "\u30b7\u30a7\u30a4\u30d7\u3092\u9078\u3093\u3067 [\u9069\u7528]\u3002\n\u8abf\u6574\u306f\u30b7\u30a7\u30a4\u30d7\u306e GL \u30b9\u30e9\u30a4\u30c0\u30fc\u3067\u3002\n\u30b0\u30eb\u30fc\u30d7\u3092\u8ffd\u52a0/\u524a\u9664\u3057\u305f\u3089 [\u518d\u69cb\u7bc9]\u3002",
        noComp:    "GlassLens: \u30b3\u30f3\u30dd\u30b8\u30b7\u30e7\u30f3\u3092\u958b\u3044\u3066\u304f\u3060\u3055\u3044\u3002",
        noShape:   "GlassLens: \u30b7\u30a7\u30a4\u30d7\u30ec\u30a4\u30e4\u30fc\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002",
        noRig:     "GlassLens: GlassLens \u3092\u9069\u7528\u3057\u305f\u30b7\u30a7\u30a4\u30d7\uff08\u307e\u305f\u306f\u88dc\u52a9\u30ec\u30a4\u30e4\u30fc\uff09\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044\u3002",
        error:     "GlassLens \u30a8\u30e9\u30fc:"
    };

    // =================================================================
    // 汎用ヘルパー
    // =================================================================
    function q(s) { // エクスプレッション用の文字列リテラル
        return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }

    function isShapeLayer(l) { return !!l && l.matchName === "ADBE Vector Layer"; }

    function getToken(layer) {
        var m = /GLASSLENS_MASTER:(\w+)/.exec(layer.comment || "");
        return m ? m[1] : null;
    }

    function rigToken(item) {
        var m = /GLASSLENS_RIG:(\w+)/.exec(item.comment || "");
        return m ? m[1] : null;
    }

    function newToken() {
        var s = "";
        var c = "abcdefghijklmnopqrstuvwxyz0123456789";
        for (var i = 0; i < 8; i++) s += c.charAt(Math.floor(Math.random() * c.length));
        return s;
    }

    function fxParade(layer) { return layer.property("ADBE Effect Parade"); }

    // エフェクトのパラメータ取得（matchName → index の順で探す）
    function param(effect, matchName, index) {
        var p = null;
        try { p = effect.property(matchName); } catch (e) {}
        if (!p) { try { p = effect.property(index); } catch (e2) {} }
        if (!p) throw new Error("Parameter not found: " + effect.matchName + " / " + matchName);
        return p;
    }
    function setParam(effect, matchName, index, value) { param(effect, matchName, index).setValue(value); }
    function setExprParam(effect, matchName, index, expr) { param(effect, matchName, index).expression = expr; }

    // 追加したエフェクトを返す（以前の参照は無効になる点に注意）
    function addEffect(layer, matchName, name) {
        var fx = fxParade(layer).addProperty(matchName);
        if (!fx) throw new Error("Could not add effect: " + matchName);
        if (name) fx.name = name;
        return fx;
    }

    function removeAllEffects(layer) {
        // 削除のたびに参照が無効になるので毎回取り直す
        while (fxParade(layer).numProperties > 0) fxParade(layer).property(1).remove();
    }

    function tr(layer, matchName) { // トランスフォームのプロパティを毎回取り直す
        return layer.property("ADBE Transform Group").property(matchName);
    }

    function uniqueCompName(comp) {
        var n = 0;
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === comp.name) n++;
        }
        if (n > 1) comp.name = comp.name + " (" + comp.id + ")";
    }

    function uniqueLayerName(comp, layer) {
        var n = 0;
        for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === layer.name) n++;
        if (n > 1) layer.name = layer.name + " " + layer.index;
    }

    function getFolder() {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof FolderItem && it.name === CONFIG.folderName) return it;
        }
        return app.project.items.addFolder(CONFIG.folderName);
    }

    // =================================================================
    // コントロール（マスターのエフェクト）
    // =================================================================
    function findControl(master, key) {
        return fxParade(master).property(CTRL[key]);
    }

    function ensureControls(master) {
        for (var i = 0; i < CTRL_ORDER.length; i++) {
            var key = CTRL_ORDER[i];
            if (findControl(master, key)) continue;
            var fx = addEffect(master, CTRL_CHECKBOX[key] ? "ADBE Checkbox Control" : "ADBE Slider Control", CTRL[key]);
            fx.property(1).setValue(CONFIG[key]);
        }
    }

    function removeControls(master) {
        for (var i = 0; i < CTRL_ORDER.length; i++) {
            var fx = findControl(master, CTRL_ORDER[i]);
            if (fx) fx.remove();
        }
    }

    function applyPresetValues(master, values) {
        ensureControls(master);
        for (var k in values) {
            if (!values.hasOwnProperty(k) || !CTRL[k]) continue;
            var p = findControl(master, k).property(1);
            if (p.numKeys > 0) continue;          // キーフレームがある値は上書きしない
            p.setValue(values[k]);
        }
    }

    // =================================================================
    // リンク（モーフィング・モーション追従の要）
    // =================================================================
    // 兄弟の中で一意に特定できる参照（matchName → name → index の順）
    function childRef(group, i) {
        var p = group.property(i);
        var sameMn = 0, sameName = 0;
        for (var k = 1; k <= group.numProperties; k++) {
            var s = group.property(k);
            if (s.matchName === p.matchName) sameMn++;
            if (s.name === p.name) sameName++;
        }
        if (sameMn === 1) return "(" + q(p.matchName) + ")";
        if (sameName === 1) return "(" + q(p.name) + ")";
        return "(" + i + ")";
    }

    // src の全プロパティを dst にエクスプレッションでリンク
    function linkGroup(src, dst, ref, skip) {
        var n = Math.min(src.numProperties, dst.numProperties);
        for (var i = 1; i <= n; i++) {
            var sp = src.property(i), dp = dst.property(i);
            if (!sp || !dp || sp.matchName !== dp.matchName) continue;
            if (skip && skip[sp.matchName]) continue;
            var r = ref + childRef(src, i);
            if (sp.propertyType === PropertyType.PROPERTY) {
                if (dp.canSetExpression) {
                    try { dp.expression = r; } catch (e) {}
                }
            } else {
                linkGroup(sp, dp, r, skip);
            }
        }
    }

    function linkContents(master, dup, mRef) {
        linkGroup(master.property("ADBE Root Vectors Group"),
                  dup.property("ADBE Root Vectors Group"),
                  mRef + '("ADBE Root Vectors Group")', null);
    }

    // 同じコンプ内の複製: トランスフォームを直接リンク（親子付けも複製が引き継ぐ）
    function linkTransformSameComp(master, dup, mRef) {
        linkGroup(master.property("ADBE Transform Group"),
                  dup.property("ADBE Transform Group"),
                  mRef + '("ADBE Transform Group")',
                  { "ADBE Opacity": true });
    }

    // 別コンプ（プリコンプ）内の複製: toComp で親子付け込みのコンプ座標に変換
    function linkTransformToComp(dup, mRef) {
        var head = "var L=" + mRef + ";var a=L.transform.anchorPoint;" +
                   "var dx=a.length>2?[100,0,0]:[100,0];var dy=a.length>2?[0,100,0]:[0,100];" +
                   "var o=L.toComp(a);var px=sub(L.toComp(add(a,dx)),o);var py=sub(L.toComp(add(a,dy)),o);";
        dup.threeDLayer = false;
        try { if (tr(dup, "ADBE Position").dimensionsSeparated) tr(dup, "ADBE Position").dimensionsSeparated = false; } catch (e) {}
        tr(dup, "ADBE Anchor Point").expression = "var a=" + mRef + ".transform.anchorPoint;[a[0],a[1]]";
        tr(dup, "ADBE Position").expression = head + "[o[0],o[1]]";
        tr(dup, "ADBE Rotate Z").expression = head + "radiansToDegrees(Math.atan2(px[1],px[0]))";
        tr(dup, "ADBE Scale").expression = head +
            "var sx=length(px),sy=length(py);if(px[0]*py[1]-px[1]*py[0]<0)sy=-sy;[sx,sy]";
        tr(dup, "ADBE Opacity").expression = "100";
    }

    function cleanDup(dup, token, name) {
        dup.locked = false;                      // マスターがロックされていた場合
        removeAllEffects(dup);
        try { if (dup.hasTrackMatte) dup.trackMatteType = TrackMatteType.NO_TRACK_MATTE; } catch (e) {}
        dup.enabled = true;
        dup.adjustmentLayer = false;
        dup.blendingMode = BlendingMode.NORMAL;
        dup.shy = false;
        dup.comment = TAG_RIG + token;           // マスターの GLASSLENS_MASTER タグを上書き
        dup.name = name;
        return dup;
    }

    function addOffsetPaths(dup, name, amountExpr) {
        var off = dup.property("ADBE Root Vectors Group").addProperty("ADBE Vector Filter - Offset");
        if (!off) throw new Error("Could not add Offset Paths");
        off.name = name;
        off.property("ADBE Vector Offset Amount").expression = amountExpr;
    }

    // =================================================================
    // マット
    // =================================================================
    function canSetTrackMatte(layer) { return typeof layer.setTrackMatte === "function"; }

    function applyMatte(target, matte, inverted, makeFallbackMatte) {
        var type = inverted ? TrackMatteType.ALPHA_INVERTED : TrackMatteType.ALPHA;
        if (canSetTrackMatte(target)) { target.setTrackMatte(matte, type); return; }
        // 旧AE: ターゲットの直上にマット用レイヤーが必要
        var m = makeFallbackMatte ? makeFallbackMatte() : matte;
        m.moveBefore(target);
        target.trackMatteType = type;
    }

    // =================================================================
    // 構築
    // =================================================================
    function build(comp, master, opts) {
        if (!isShapeLayer(master)) throw new Error("\"" + master.name + "\" is not a shape layer.");
        if (typeof master.copyToComp !== "function") throw new Error("This After Effects version does not support Layer.copyToComp().");

        var wasLocked = master.locked;
        master.locked = false;

        uniqueCompName(comp);
        uniqueLayerName(comp, master);

        var token = getToken(master);
        if (!token) {
            token = newToken();
            master.comment = (master.comment ? master.comment + "\n" : "") + TAG_MASTER + token;
        } else {
            removeRig(comp, token);
        }
        if (opts && opts.bpc16 && app.project.bitsPerChannel < 16) app.project.bitsPerChannel = 16;

        // 既存のスライダー値はそのまま（無いものだけ追加）。
        // 複製レイヤーに乗ったエフェクトは cleanDup で全部外す。
        ensureControls(master);

        var W = comp.width, H = comp.height, PA = comp.pixelAspect, D = comp.duration, FPS = comp.frameRate;
        var base = master.name;
        var suffix = " - " + base;
        var mRef = "comp(" + q(comp.name) + ").layer(" + q(master.name) + ")";
        var mapName = "GL Map" + suffix;
        var mapRef = "comp(" + q(comp.name) + ").layer(" + q(mapName) + ")";
        function C(key) { return mRef + ".effect(" + q(CTRL[key]) + ")(1)"; }
        var EDGE = mapRef + ".effect(\"GL Edge px\")(1)";   // 自動計算されたエッジ幅(px)
        var DISP = mapRef + ".effect(\"GL Disp px\")(1)";   // 自動計算された屈折量(px)
        var folder = getFolder();

        // ---------------------------------------------------------- 空のプリコンプを先に作る
        // （プリコンプ内のエクスプレッションが参照する GL Map を先にメインコンプへ置くため。
        //   参照先が無い状態でエクスプレッションを入れると AE がそれを無効化してしまう）
        var hComp = app.project.items.addComp("GL_H_" + base, W, H, PA, D, FPS);
        hComp.parentFolder = folder;
        hComp.comment = TAG_RIG + token;
        var mapComp = app.project.items.addComp("GL_MAP_" + base, W, H, PA, D, FPS);
        mapComp.parentFolder = folder;
        mapComp.comment = TAG_RIG + token;

        // ---------------------------------------------------------- メインコンプ: ヘルパー
        var made = [];
        function tag(l, name) {
            l.name = name;
            l.comment = TAG_RIG + token;
            made.push(l);
            return l;
        }
        function adjSolid(name) {
            var s = comp.layers.addSolid([1, 1, 1], name, W, H, PA, D);
            s.adjustmentLayer = true;
            s.moveAfter(master);
            return tag(s, name);
        }
        function sameCompDup(name) {
            var d = master.duplicate();
            cleanDup(d, token, name);
            linkContents(master, d, mRef);
            linkTransformSameComp(master, d, mRef);
            d.moveAfter(master);
            return tag(d, name);
        }
        function masterMatte() { // 旧AE用: マスターと同形のマット
            var m = sameCompDup("GL Matte" + suffix);
            m.enabled = false;
            return m;
        }

        // Map（非表示）＋ 自動計算値
        var mapLayer = comp.layers.add(mapComp);
        mapLayer.moveAfter(master);
        tag(mapLayer, mapName);
        mapLayer.enabled = false;
        // エッジ幅(px) = シェイプ（コンプ上での見た目）の短辺の半分 × Edge Width%
        var edgeFx = addEffect(mapLayer, "ADBE Slider Control", "GL Edge px");
        edgeFx.property(1).expression =
            "var L=" + mRef + ";var r=L.sourceRectAtTime(time,false);" +
            "var t=L.transform.anchorPoint.length>2;" +
            "function P(x,y){return L.toComp(t?[x,y,0]:[x,y]);}" +
            "var p0=P(r.left,r.top),p1=P(r.left+r.width,r.top),p2=P(r.left,r.top+r.height);" +
            "var s=Math.min(length(sub(p1,p0)),length(sub(p2,p0)))/2;" +
            "Math.max(0.5,s*" + C("edgeWidth") + "/100)";
        var dispFx = addEffect(mapLayer, "ADBE Slider Control", "GL Disp px");
        dispFx.property(1).expression =
            "var m=" + C("invert") + ">0?-1:1;" + EDGE + "*" + C("refraction") + "/50*m";

        // ---------------------------------------------------------- H precomp の中身
        master.copyToComp(hComp);
        var hDup = hComp.layer(1);
        cleanDup(hDup, token, "GL Height");
        try { hDup.parent = null; } catch (e) {}
        hDup.startTime = 0; hDup.inPoint = 0; hDup.outPoint = D;
        linkContents(master, hDup, mRef);
        linkTransformToComp(hDup, mRef);
        addOffsetPaths(hDup, "GL Erode", "-" + EDGE + "*" + CONFIG.erodeK);
        setParam(addEffect(hDup, "ADBE Fill", "GL Fill"), "ADBE Fill-0002", 3, [1, 1, 1, 1]);
        var hBlur = addEffect(hDup, "ADBE Box Blur2", "GL Height Blur");
        setExprParam(hBlur, "ADBE Box Blur2-0001", 1, "Math.max(0," + EDGE + "*" + CONFIG.blurK + ")");
        setParam(hBlur, "ADBE Box Blur2-0002", 2, 3);
        setParam(hBlur, "ADBE Box Blur2-0004", 4, 0);

        // ---------------------------------------------------------- MAP precomp の中身
        // R = 0.5 + 0.5*(h(x-e) - h(x+e)),  G = 同様に y 方向
        var neutral = mapComp.layers.addSolid([0.5, 0.5, 0], "GL Neutral", W, H, PA, D);
        neutral.comment = TAG_RIG + token;
        // [ 色, ずらし方向x, ずらし方向y, ブレンド, 名前 ]
        var inst = [
            [[0.5, 0, 0, 1],  1, 0, BlendingMode.ADD,      "GL +X"],
            [[0, 0.5, 0, 1],  0, 1, BlendingMode.ADD,      "GL +Y"],
            [[0.5, 0, 0, 1], -1, 0, BlendingMode.SUBTRACT, "GL -X"],
            [[0, 0.5, 0, 1],  0, -1, BlendingMode.SUBTRACT, "GL -Y"]
        ];
        for (var j = 0; j < inst.length; j++) {
            var L = mapComp.layers.add(hComp);
            L.name = inst[j][4];
            L.comment = TAG_RIG + token;
            L.blendingMode = inst[j][3];
            setParam(addEffect(L, "ADBE Fill", "GL Fill"), "ADBE Fill-0002", 3, inst[j][0]);
            tr(L, "ADBE Position").expression =
                "var e=" + EDGE + "*" + CONFIG.gradK + ";" +
                "[thisComp.width/2+(" + inst[j][1] + ")*e, thisComp.height/2+(" + inst[j][2] + ")*e]";
        }

        // ---------------------------------------------------------- メインコンプ: エフェクト
        // Lens（屈折本体）
        var lens = adjSolid("GL Lens" + suffix);
        var frost = addEffect(lens, "ADBE Box Blur2", "GL Frost");
        setExprParam(frost, "ADBE Box Blur2-0001", 1, "Math.max(0," + C("frost") + ")");
        setParam(frost, "ADBE Box Blur2-0002", 2, 3);
        setParam(frost, "ADBE Box Blur2-0004", 4, 1);

        var centerExpr = "var L=" + mRef + ";var r=L.sourceRectAtTime(time,false);" +
                         "var c=[r.left+r.width/2,r.top+r.height/2];" +
                         "if(L.transform.anchorPoint.length>2)c=[c[0],c[1],0];" +
                         "var p=L.toComp(c);[p[0],p[1]]";
        var mag = addEffect(lens, "ADBE Geometry2", "GL Magnify");
        setExprParam(mag, "ADBE Geometry2-0001", 1, centerExpr);
        setExprParam(mag, "ADBE Geometry2-0002", 2, centerExpr);
        setExprParam(mag, "ADBE Geometry2-0003", 4, "100+" + C("magnify"));
        setExprParam(mag, "ADBE Geometry2-0004", 5, "100+" + C("magnify"));

        function addDisplace(layer, name, amountExpr) {
            var dm = addEffect(layer, "ADBE Displacement Map", name);
            setParam(dm, "ADBE Displacement Map-0001", 1, mapLayer.index);
            setParam(dm, "ADBE Displacement Map-0002", 2, 1);   // 横 = Red
            setExprParam(dm, "ADBE Displacement Map-0003", 3, amountExpr);
            setParam(dm, "ADBE Displacement Map-0004", 4, 2);   // 縦 = Green
            setExprParam(dm, "ADBE Displacement Map-0005", 5, amountExpr);
            setParam(dm, "ADBE Displacement Map-0006", 6, 2);   // Stretch Map to Fit
            setParam(dm, "ADBE Displacement Map-0007", 7, 0);   // Wrap Pixels Around: off
        }
        addDisplace(lens, "GL Refract", DISP);
        applyMatte(lens, master, false, masterMatte);

        // 色収差（赤/青だけ追加でずらして Lighten）
        function dispLayer(name, sign, keep) {
            var l = adjSolid(name);
            addDisplace(l, "GL Refract", "(" + sign + ")*" + DISP + "*" + C("dispersion") + "/100");
            var sc = addEffect(l, "ADBE Shift Channels", "GL Keep Channel");
            // 1 Alpha 2 Red 3 Green 4 Blue ... 11 Full Off
            setParam(sc, "ADBE Shift Channels-0002", 2, keep === "R" ? 2 : 11);
            setParam(sc, "ADBE Shift Channels-0003", 3, 11);
            setParam(sc, "ADBE Shift Channels-0004", 4, keep === "B" ? 4 : 11);
            l.blendingMode = BlendingMode.LIGHTEN;
            tr(l, "ADBE Opacity").expression = C("dispersion") + ">0?100:0";
            applyMatte(l, master, false, masterMatte);
        }
        dispLayer("GL Disp R" + suffix, 1, "R");
        dispLayer("GL Disp B" + suffix, -1, "B");

        // リム（縁ハイライト）: マスター形状 − 内側に縮めた形状
        var rim = sameCompDup("GL Rim" + suffix);
        setParam(addEffect(rim, "ADBE Fill", "GL Fill"), "ADBE Fill-0002", 3, [1, 1, 1, 1]);
        var rBlur = addEffect(rim, "ADBE Box Blur2", "GL Soft");
        setParam(rBlur, "ADBE Box Blur2-0001", 1, 1);
        setParam(rBlur, "ADBE Box Blur2-0002", 2, 1);
        rim.blendingMode = BlendingMode.ADD;
        tr(rim, "ADBE Opacity").expression = C("rimOpacity") + "*" + mRef + ".transform.opacity/100";
        var rimInner = sameCompDup("GL Rim Inner" + suffix);
        addOffsetPaths(rimInner, "GL Rim Offset", "-Math.max(0," + C("rimWidth") + ")");
        rimInner.moveBefore(rim);
        rimInner.enabled = false;
        applyMatte(rim, rimInner, true, null);

        // マスターはマット専用（非表示）。中身は屈折で見せる
        master.enabled = false;

        for (var m = 0; m < made.length; m++) {
            made[m].shy = true;
            made[m].locked = true;
        }
        comp.hideShyLayers = true;
        if (wasLocked) master.locked = true;
        return token;
    }

    // =================================================================
    // 削除
    // =================================================================
    function removeRig(comp, token) {
        var solids = [];
        // メインコンプのリグレイヤー（ロック解除してから削除）
        for (var i = comp.numLayers; i >= 1; i--) {
            var l = comp.layer(i);
            if (rigToken(l) !== token) continue;
            l.locked = false;
            if (l.source && l.source.mainSource && l.source.mainSource instanceof SolidSource) solids.push(l.source);
            l.remove();
        }
        // プリコンプ（MAP → H の順）
        var prefixes = ["GL_MAP_", ""];
        for (var p = 0; p < prefixes.length; p++) {
            for (var j = app.project.numItems; j >= 1; j--) {
                var it = app.project.item(j);
                if (!(it instanceof CompItem) || rigToken(it) !== token) continue;
                if (prefixes[p] && it.name.indexOf(prefixes[p]) !== 0) continue;
                for (var k = 1; k <= it.numLayers; k++) {
                    var s = it.layer(k).source;
                    if (s && s.mainSource && s.mainSource instanceof SolidSource) solids.push(s);
                }
                it.remove();
            }
        }
        // 使われなくなった平面を片付ける
        for (var n = 0; n < solids.length; n++) {
            try { if (solids[n].usedIn.length === 0) solids[n].remove(); } catch (e) {}
        }
    }

    function removeAll(comp, master) {
        var token = getToken(master);
        if (!token) return false;
        var wasLocked = master.locked;
        master.locked = false;
        removeRig(comp, token);
        removeControls(master);
        master.comment = master.comment.replace(new RegExp("\\n?" + TAG_MASTER + token), "");
        master.enabled = true;
        if (wasLocked) master.locked = true;
        return true;
    }

    // =================================================================
    // 選択の解決（リグレイヤーを選んでいてもマスターを見つける）
    // =================================================================
    function selectedMasters(comp, requireRig) {
        var out = [], seen = {};
        var sel = comp.selectedLayers;
        for (var i = 0; i < sel.length; i++) {
            var l = sel[i], m = null;
            if (getToken(l)) m = l;
            else {
                var t = rigToken(l);
                if (t) {
                    for (var j = 1; j <= comp.numLayers; j++) {
                        if (getToken(comp.layer(j)) === t) { m = comp.layer(j); break; }
                    }
                } else if (!requireRig && isShapeLayer(l)) m = l;
            }
            if (m && !seen[m.index]) { seen[m.index] = true; out.push(m); }
        }
        return out;
    }

    function activeComp() {
        var c = app.project.activeItem;
        if (!(c instanceof CompItem)) { alert(T.noComp); return null; }
        return c;
    }

    // mode: "apply" | "rebuild" | "remove" | "preset"
    function run(mode, opts) {
        var comp = activeComp();
        if (!comp) return false;
        var masters = selectedMasters(comp, mode !== "apply");
        if (masters.length === 0) {
            alert(mode === "apply" ? T.noShape : T.noRig);
            return false;
        }
        var ok = true;
        app.beginUndoGroup("GlassLens " + mode);
        try {
            for (var i = 0; i < masters.length; i++) {
                if (mode === "remove") removeAll(comp, masters[i]);
                else if (mode === "preset") applyPresetValues(masters[i], opts.values);
                else build(comp, masters[i], opts);
            }
        } catch (e) {
            ok = false;
            alert(T.error + "\n" + e.toString() + (e.line ? "\n(line " + e.line + ")" : ""));
        }
        app.endUndoGroup();
        return ok;
    }

    function toggleRigVisibility() {
        var comp = activeComp();
        if (comp) comp.hideShyLayers = !comp.hideShyLayers;
    }

    // =================================================================
    // UI
    // =================================================================
    function buildUI(thisObj) {
        var win = (thisObj instanceof Panel) ? thisObj
                : new Window("palette", "GlassLens", undefined, { resizeable: true });
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 6;
        win.margins = 10;

        win.add("statictext", undefined, T.title);

        var bApply = win.add("button", undefined, T.apply);
        var row1 = win.add("group");
        row1.orientation = "row";
        row1.alignChildren = ["fill", "center"];
        var bRebuild = row1.add("button", undefined, T.rebuild);
        var bRemove  = row1.add("button", undefined, T.remove);

        var pRow = win.add("group");
        pRow.orientation = "row";
        pRow.alignChildren = ["left", "center"];
        pRow.add("statictext", undefined, T.presetLbl);
        var labels = [];
        for (var i = 0; i < PRESETS.length; i++) labels.push(PRESETS[i].label);
        var ddPreset = pRow.add("dropdownlist", undefined, labels);
        ddPreset.selection = 0;
        var bPreset = pRow.add("button", undefined, T.presetBtn);

        var cb16 = win.add("checkbox", undefined, T.bpc);
        cb16.value = true;
        var bToggle = win.add("button", undefined, T.toggle);

        var info = win.add("statictext", undefined, T.help, { multiline: true });
        info.preferredSize = [220, 48];

        bApply.onClick   = function () { run("apply",   { bpc16: cb16.value }); };
        bRebuild.onClick = function () { run("rebuild", { bpc16: cb16.value }); };
        bRemove.onClick  = function () { run("remove"); };
        bPreset.onClick  = function () {
            var idx = ddPreset.selection ? ddPreset.selection.index : 0;
            run("preset", { values: PRESETS[idx].v });
        };
        bToggle.onClick  = toggleRigVisibility;

        win.onResizing = win.onResize = function () { this.layout.resize(); };
        if (win instanceof Window) { win.center(); win.show(); }
        else win.layout.layout(true);
        return win;
    }

    // テスト用フック（AE 上では何もしない）
    if (typeof $.global !== "undefined" && $.global.__GLASSLENS_TEST__) {
        $.global.__GLASSLENS__ = { run: run, build: build, removeAll: removeAll, PRESETS: PRESETS, CTRL: CTRL, buildUI: buildUI };
        return;
    }
    buildUI(thisObj);

})(this);
