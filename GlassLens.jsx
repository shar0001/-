/**********************************************************************
 * GlassLens.jsx  v1.0
 * --------------------------------------------------------------------
 * シェイプレイヤー1枚を「ガラスのレンズ」にする After Effects スクリプト。
 * 参考: 2D SDF Shape で背景を屈折させるガラス表現
 *       （縁に向かって強く屈折 / 縁に沿って縞が圧縮 / 色収差 / 細いリム）
 *
 * ■ 一つのシェイプで完結
 *   - 選択したシェイプレイヤー（＝マスター）にボタン1つで適用。
 *   - 調整はすべてマスターのエフェクトコントロール（GL ～ スライダー）で行う。
 *   - 生成される補助レイヤーはシャイ＋ロック。触る必要なし。
 *
 * ■ モーション・モーフィングで崩れない
 *   - 補助レイヤーはマスターの「コンテンツの全プロパティ」と「トランスフォーム」に
 *     エクスプレッションでリンク。パスのキーフレーム（モーフィング）、
 *     楕円/長方形のサイズ・角丸、グループのトランスフォーム、レイヤーの移動・
 *     回転・スケール・親子付けにすべて追従する。
 *   - 屈折マップはコンプ座標で毎フレーム生成されるため、形が変わっても破綻しない。
 *   - シェイプのグループを追加・削除した（構造が変わった）ときだけ [Rebuild] を押す。
 *
 * ■ 仕組み（2D SDF 的なハイトマップ → 法線 → 変位）
 *   GL_H_<名前>   : マスターのリンク複製を白で塗り → Fast Box Blur
 *                   ＝縁で0→内側で1になる高さマップ（SDFを滑らかにしたもの）
 *   GL_MAP_<名前> : 高さマップを ±e ずらして 加算/減算 → 勾配（法線）を
 *                   R=横, G=縦 に格納した変位マップ（中立=50%グレー）
 *   メインコンプ   : 調整レイヤーで 拡大(Transform) → Displacement Map。
 *                   赤/青だけ少しずらして Lighten → 色収差。
 *                   マスターのアルファでマット → シェイプの内側だけに効く。
 *
 * ■ レイヤー構成（メインコンプ、上から）
 *   <マスター>            … 操作するのはこれだけ（マットとして非表示になる）
 *   GL Rim Inner / GL Rim … 縁のハイライト
 *   GL Disp B / GL Disp R … 色収差
 *   GL Lens               … 屈折本体
 *   GL Map                … 変位マップ（非表示）
 *
 * ■ 動作環境: After Effects 2023 (v23) 以降を推奨
 *   （トラックマットのレイヤー指定 API を使用。旧バージョンでは
 *     マット用の複製レイヤーを自動で挟むフォールバックで動作）
 *   ビット深度は 16bpc 以上を推奨（8bpc だと屈折にわずかな段差が出る）。
 **********************************************************************/

(function GlassLens(thisObj) {

    // =================================================================
    // CONFIG
    // =================================================================
    var CONFIG = {
        folderName: "GlassLens Rigs",

        // スライダー初期値
        refraction:  150,   // 屈折の強さ(px)。マイナスで向きが反転
        edgeWidth:   140,   // 屈折が起きる縁の幅(px)
        magnify:     105,   // 内側の拡大率(%)
        dispersion:  5,     // 色収差(屈折に対する%)
        frost:       0,     // すりガラスぼかし(px)
        rimOpacity:  50,    // 縁ハイライトの不透明度(%)
        rimWidth:    2,     // 縁ハイライトの幅(px)

        // 内部係数（エッジ幅に対する比率）
        erodeK: 0.05,       // 高さマップの収縮
        blurK:  0.33,       // 高さマップのぼかし半径
        gradK:  0.33        // 勾配を取るときのずらし量
    };

    var CTRL = {
        refraction: "GL Refraction",
        edgeWidth:  "GL Edge Width",
        magnify:    "GL Magnify",
        dispersion: "GL Dispersion",
        frost:      "GL Frost Blur",
        rimOpacity: "GL Rim Opacity",
        rimWidth:   "GL Rim Width"
    };
    var CTRL_ORDER = ["refraction", "edgeWidth", "magnify", "dispersion", "frost", "rimOpacity", "rimWidth"];

    var TAG_MASTER = "GLASSLENS_MASTER:";
    var TAG_RIG    = "GLASSLENS_RIG:";

    // =================================================================
    // 汎用ヘルパー
    // =================================================================
    function q(s) { // エクスプレッション用の文字列リテラル
        return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }

    function isShapeLayer(l) { return l && l.matchName === "ADBE Vector Layer"; }

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

    function setParam(effect, matchName, index, value) {
        var p = null;
        try { p = effect.property(matchName); } catch (e) {}
        if (!p) { try { p = effect.property(index); } catch (e2) {} }
        if (p) p.setValue(value);
        return p;
    }

    function setExprParam(effect, matchName, index, expr) {
        var p = null;
        try { p = effect.property(matchName); } catch (e) {}
        if (!p) { try { p = effect.property(index); } catch (e2) {} }
        if (p) p.expression = expr;
        return p;
    }

    function addEffect(layer, matchName, name) {
        var fx = layer.property("ADBE Effect Parade").addProperty(matchName);
        if (name) fx.name = name;
        return fx;
    }

    function removeAllEffects(layer) {
        var parade = layer.property("ADBE Effect Parade");
        for (var i = parade.numProperties; i >= 1; i--) parade.property(i).remove();
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
        if (n > 1) layer.name = layer.name + " GL" + layer.index;
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
    function ensureControls(master) {
        var parade = master.property("ADBE Effect Parade");
        for (var i = 0; i < CTRL_ORDER.length; i++) {
            var key = CTRL_ORDER[i];
            var fx = parade.property(CTRL[key]);
            if (!fx) {
                fx = parade.addProperty("ADBE Slider Control");
                fx.name = CTRL[key];
                fx.property(1).setValue(CONFIG[key]);
            }
        }
    }

    function removeControls(master) {
        var parade = master.property("ADBE Effect Parade");
        for (var i = 0; i < CTRL_ORDER.length; i++) {
            var fx = parade.property(CTRL[CTRL_ORDER[i]]);
            if (fx) fx.remove();
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
        var tr = dup.property("ADBE Transform Group");
        dup.threeDLayer = false;
        try { tr.property("ADBE Position").dimensionsSeparated = false; } catch (e) {}
        tr.property("ADBE Anchor Point").expression = "var a=" + mRef + ".transform.anchorPoint;[a[0],a[1]]";
        tr.property("ADBE Position").expression = head + "[o[0],o[1]]";
        tr.property("ADBE Rotate Z").expression = head + "radiansToDegrees(Math.atan2(px[1],px[0]))";
        tr.property("ADBE Scale").expression = head +
            "var sx=length(px),sy=length(py);if(px[0]*py[1]-px[1]*py[0]<0)sy=-sy;[sx,sy]";
        tr.property("ADBE Opacity").expression = "100";
    }

    function cleanDup(dup, token, name) {
        removeAllEffects(dup);
        try { if (dup.hasTrackMatte) dup.trackMatteType = TrackMatteType.NO_TRACK_MATTE; } catch (e) {}
        dup.enabled = true;
        dup.adjustmentLayer = false;
        dup.blendingMode = BlendingMode.NORMAL;
        dup.comment = TAG_RIG + token;   // マスターの GLASSLENS_MASTER タグを上書き
        dup.name = name;
        return dup;
    }

    function addOffsetPaths(dup, name, amountExpr) {
        var off = dup.property("ADBE Root Vectors Group").addProperty("ADBE Vector Filter - Offset");
        off.name = name;
        off.property("ADBE Vector Offset Amount").expression = amountExpr;
        return off;
    }

    // =================================================================
    // マット
    // =================================================================
    function applyMatte(target, matte, makeFallbackMatte) {
        if (typeof target.setTrackMatte === "function") {
            target.setTrackMatte(matte, TrackMatteType.ALPHA);
            return;
        }
        // 旧AE: ターゲットの直上にマット用レイヤーが必要
        var m = makeFallbackMatte();
        m.moveBefore(target);
        target.trackMatteType = TrackMatteType.ALPHA;
    }

    // =================================================================
    // 構築
    // =================================================================
    function build(comp, master) {
        if (!isShapeLayer(master)) throw new Error("\"" + master.name + "\" is not a shape layer.");
        if (typeof master.copyToComp !== "function") throw new Error("This After Effects version does not support Layer.copyToComp().");

        uniqueCompName(comp);
        uniqueLayerName(comp, master);

        var token = getToken(master);
        if (!token) {
            token = newToken();
            master.comment = (master.comment ? master.comment + "\n" : "") + TAG_MASTER + token;
        } else {
            removeRig(comp, token);
        }

        // 既存のスライダー値はそのまま（無いものだけ追加）。
        // 複製レイヤーに乗ったエフェクトは cleanDup で全部外す。
        ensureControls(master);

        var W = comp.width, H = comp.height, PA = comp.pixelAspect, D = comp.duration, FPS = comp.frameRate;
        var mRef = "comp(" + q(comp.name) + ").layer(" + q(master.name) + ")";
        function C(key) { return mRef + ".effect(" + q(CTRL[key]) + ")(1)"; }
        var folder = getFolder();
        var base = master.name;

        // ---------------------------------------------------------- H precomp
        var hComp = app.project.items.addComp("GL_H_" + base, W, H, PA, D, FPS);
        hComp.parentFolder = folder;
        hComp.comment = TAG_RIG + token;
        hComp.bgColor = [0, 0, 0];
        master.copyToComp(hComp);
        var hDup = hComp.layer(1);
        cleanDup(hDup, token, "GL Height");
        try { hDup.parent = null; } catch (e) {}
        linkContents(master, hDup, mRef);
        linkTransformToComp(hDup, mRef);
        addOffsetPaths(hDup, "GL Erode", "-" + C("edgeWidth") + "*" + CONFIG.erodeK);
        var hFill = addEffect(hDup, "ADBE Fill", "GL Fill");
        setParam(hFill, "ADBE Fill-0002", 3, [1, 1, 1, 1]);
        var hBlur = addEffect(hDup, "ADBE Box Blur2", "GL Height Blur");
        setExprParam(hBlur, "ADBE Box Blur2-0001", 1, "Math.max(0," + C("edgeWidth") + "*" + CONFIG.blurK + ")");
        setParam(hBlur, "ADBE Box Blur2-0002", 2, 3);
        setParam(hBlur, "ADBE Box Blur2-0004", 4, 0);

        // ---------------------------------------------------------- MAP precomp
        // R = 0.5 + 0.5*(h(x-e) - h(x+e)),  G = 同様に y 方向
        var mapComp = app.project.items.addComp("GL_MAP_" + base, W, H, PA, D, FPS);
        mapComp.parentFolder = folder;
        mapComp.comment = TAG_RIG + token;
        var neutral = mapComp.layers.addSolid([0.5, 0.5, 0], "GL Neutral", W, H, PA, D);
        neutral.comment = TAG_RIG + token;
        // [ 色, ずらし方向x, ずらし方向y, ブレンド ]
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
            var f = addEffect(L, "ADBE Fill", "GL Fill");
            setParam(f, "ADBE Fill-0002", 3, inst[j][0]);
            L.property("ADBE Transform Group").property("ADBE Position").expression =
                "var e=" + C("edgeWidth") + "*" + CONFIG.gradK + ";" +
                "[thisComp.width/2+(" + inst[j][1] + ")*e, thisComp.height/2+(" + inst[j][2] + ")*e]";
        }

        // ---------------------------------------------------------- メインコンプ
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
            s.startTime = 0;
            s.inPoint = master.inPoint;
            s.outPoint = master.outPoint;
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
            var m = sameCompDup("GL Matte");
            m.enabled = false;
            return m;
        }

        // Map（非表示）
        var mapLayer = comp.layers.add(mapComp);
        mapLayer.moveAfter(master);
        tag(mapLayer, "GL Map");
        mapLayer.enabled = false;

        // Lens（屈折本体）
        var lens = adjSolid("GL Lens");
        var frost = addEffect(lens, "ADBE Box Blur2", "GL Frost");
        setExprParam(frost, "ADBE Box Blur2-0001", 1, C("frost"));
        setParam(frost, "ADBE Box Blur2-0002", 2, 3);
        setParam(frost, "ADBE Box Blur2-0004", 4, 1);

        var centerExpr = "var L=" + mRef + ";var r=L.sourceRectAtTime(time,false);" +
                         "var c=[r.left+r.width/2,r.top+r.height/2];" +
                         "if(L.transform.anchorPoint.length>2)c=[c[0],c[1],0];" +
                         "var p=L.toComp(c);[p[0],p[1]]";
        var mag = addEffect(lens, "ADBE Geometry2", "GL Magnify");
        setExprParam(mag, "ADBE Geometry2-0001", 1, centerExpr);
        setExprParam(mag, "ADBE Geometry2-0002", 2, centerExpr);
        setExprParam(mag, "ADBE Geometry2-0003", 4, C("magnify"));
        setExprParam(mag, "ADBE Geometry2-0004", 5, C("magnify"));

        function addDisplace(layer, name, amountExpr) {
            var dm = addEffect(layer, "ADBE Displacement Map", name);
            setParam(dm, "ADBE Displacement Map-0001", 1, mapLayer.index);
            setParam(dm, "ADBE Displacement Map-0002", 2, 1);   // 横 = Red
            setExprParam(dm, "ADBE Displacement Map-0003", 3, amountExpr);
            setParam(dm, "ADBE Displacement Map-0004", 4, 2);   // 縦 = Green
            setExprParam(dm, "ADBE Displacement Map-0005", 5, amountExpr);
            setParam(dm, "ADBE Displacement Map-0006", 6, 2);   // Stretch Map to Fit
            setParam(dm, "ADBE Displacement Map-0007", 7, 0);   // Wrap Pixels Around: off
            return dm;
        }
        addDisplace(lens, "GL Refract", C("refraction"));
        applyMatte(lens, master, masterMatte);

        // 色収差（赤/青だけ追加でずらして Lighten）
        function dispLayer(name, sign, keep) {
            var l = adjSolid(name);
            addDisplace(l, "GL Refract", "(" + sign + ")*" + C("refraction") + "*" + C("dispersion") + "/100");
            var sc = addEffect(l, "ADBE Shift Channels", "GL Keep Channel");
            // 1 Alpha 2 Red 3 Green 4 Blue ... 11 Full Off
            setParam(sc, "ADBE Shift Channels-0002", 2, keep === "R" ? 2 : 11);
            setParam(sc, "ADBE Shift Channels-0003", 3, 11);
            setParam(sc, "ADBE Shift Channels-0004", 4, keep === "B" ? 4 : 11);
            l.blendingMode = BlendingMode.LIGHTEN;
            l.property("ADBE Transform Group").property("ADBE Opacity").expression =
                C("dispersion") + "!=0?100:0";
            applyMatte(l, master, masterMatte);
            return l;
        }
        dispLayer("GL Disp R", 1, "R");
        dispLayer("GL Disp B", -1, "B");

        // リム（縁ハイライト）: マスター形状 − 内側に縮めた形状
        var rim = sameCompDup("GL Rim");
        var rFill = addEffect(rim, "ADBE Fill", "GL Fill");
        setParam(rFill, "ADBE Fill-0002", 3, [1, 1, 1, 1]);
        var rBlur = addEffect(rim, "ADBE Box Blur2", "GL Soft");
        setParam(rBlur, "ADBE Box Blur2-0001", 1, 1);
        setParam(rBlur, "ADBE Box Blur2-0002", 2, 1);
        rim.blendingMode = BlendingMode.ADD;
        rim.property("ADBE Transform Group").property("ADBE Opacity").expression =
            C("rimOpacity") + "*" + mRef + ".transform.opacity/100";
        var rimInner = sameCompDup("GL Rim Inner");
        addOffsetPaths(rimInner, "GL Rim Offset", "-" + C("rimWidth"));
        rimInner.moveBefore(rim);
        rimInner.enabled = false;
        if (typeof rim.setTrackMatte === "function") rim.setTrackMatte(rimInner, TrackMatteType.ALPHA_INVERTED);
        else rim.trackMatteType = TrackMatteType.ALPHA_INVERTED;

        // マスターはマット専用（非表示）。中身は屈折で見せる
        master.enabled = false;

        for (var m = 0; m < made.length; m++) {
            made[m].shy = true;
            made[m].locked = true;
        }
        comp.hideShyLayers = true;
        master.selected = true;
        return token;
    }

    // =================================================================
    // 削除
    // =================================================================
    function removeRig(comp, token) {
        for (var i = comp.numLayers; i >= 1; i--) {
            var l = comp.layer(i);
            if (rigToken(l) === token) { l.locked = false; l.remove(); }
        }
        for (var j = app.project.numItems; j >= 1; j--) {
            var it = app.project.item(j);
            if (it instanceof CompItem && rigToken(it) === token && it.name.indexOf("GL_MAP_") === 0) it.remove();
        }
        for (var k = app.project.numItems; k >= 1; k--) {
            var it2 = app.project.item(k);
            if (it2 instanceof CompItem && rigToken(it2) === token) it2.remove();
        }
    }

    function removeAll(comp, master) {
        var token = getToken(master);
        if (!token) return false;
        removeRig(comp, token);
        removeControls(master);
        master.comment = master.comment.replace(new RegExp("\\n?" + TAG_MASTER + token), "");
        master.enabled = true;
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
        if (!(c instanceof CompItem)) { alert("GlassLens: Open a composition first."); return null; }
        return c;
    }

    function run(mode) {
        var comp = activeComp();
        if (!comp) return;
        var masters = selectedMasters(comp, mode !== "apply");
        if (masters.length === 0) {
            alert(mode === "apply" ? "GlassLens: Select a shape layer." : "GlassLens: Select a GlassLens shape layer.");
            return;
        }
        app.beginUndoGroup("GlassLens " + mode);
        try {
            for (var i = 0; i < masters.length; i++) {
                if (mode === "remove") removeAll(comp, masters[i]);
                else build(comp, masters[i]);
            }
        } catch (e) {
            alert("GlassLens error:\n" + e.toString() + (e.line ? "\n(line " + e.line + ")" : ""));
        }
        app.endUndoGroup();
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

        var title = win.add("statictext", undefined, "GlassLens  - shape to glass lens");
        var bApply   = win.add("button", undefined, "Apply to selected shape");
        var bRebuild = win.add("button", undefined, "Rebuild (after adding/removing groups)");
        var bRemove  = win.add("button", undefined, "Remove");
        var info = win.add("statictext", undefined,
            "Adjust with 'GL ...' sliders on the shape.\nAnimate / morph the shape freely.",
            { multiline: true });
        info.preferredSize.height = 34;

        bApply.onClick   = function () { run("apply"); };
        bRebuild.onClick = function () { run("rebuild"); };
        bRemove.onClick  = function () { run("remove"); };

        win.onResizing = win.onResize = function () { this.layout.resize(); };
        if (win instanceof Window) { win.center(); win.show(); }
        else win.layout.layout(true);
        return win;
    }

    buildUI(thisObj);

})(this);
