/**********************************************************************
 * DotMagnet.jsx
 * --------------------------------------------------------------------
 * 全ドットを1枚のシェイプレイヤー（DotField）にまとめることで、
 * タイムライン上はレイヤー3枚（BG / DotField / DOT_FIELD）のみ。
 *
 *   ・DOT_FIELD ヌルを動かす  → 近くのドットがサイズ＋色で反応
 *   ・Ring Count スライダー   → 0=全消し / 11=全表示（アニメ可）
 *   ・その他スライダーで影響範囲・サイズ・色強度・ランダム量を調整
 *
 * スライダー一覧（DOT_FIELD）:
 *   Ring Count    … 表示するリングの数(0〜11)
 *   Radius        … 影響範囲(px)
 *   Max Scale     … ヌル中心での最大サイズ(%)
 *   Base Scale    … 範囲外のドットの最小サイズ(%)
 *   Falloff       … 反応の鋭さ
 *   Color Amount  … 色のつき方(%)
 *   Variation     … ドットごとのサイズのランダムばらつき(%)
 *   Seed          … ランダムの種（スクラブで変化）
 *
 * 使い方:
 *   File > Scripts > Run Script File... から本ファイルを実行。
 *   同名コンプが既にある場合は確認後に上書き。
 **********************************************************************/

(function DotMagnet(thisObj) {

    // =================================================================
    // CONFIG
    // =================================================================
    var CONFIG = {
        compName:    "DotMagnet",
        compW:       1080,
        compH:       1080,
        fps:         30,
        duration:    10,

        rings:       11,
        angular:     24,
        spacing:     40,
        addCenter:   true,

        dotSize:     18,

        // スライダー初期値
        ringCount:   11,
        radius:      320,
        maxScale:    320,
        baseScale:   35,
        falloff:     1.5,
        colorAmount: 100,
        variation:   0,
        seed:        0,

        palette: [
            [0.12, 0.45, 0.85, 1],
            [0.55, 0.80, 0.95, 1],
            [0.30, 0.85, 0.95, 1],
            [0.98, 0.82, 0.18, 1],
            [0.78, 0.74, 0.95, 1],
            [0.05, 0.12, 0.25, 1]
        ],
        bgColor: [1, 1, 1]
    };

    var CX = CONFIG.compW / 2;
    var CY = CONFIG.compH / 2;

    // =================================================================
    // グリッド座標計算（コンプ空間）
    // =================================================================
    function gridInfo(idx) {
        if (CONFIG.addCenter && idx === 0) {
            return { ring: 0, px: CX, py: CY };
        }
        var k    = CONFIG.addCenter ? idx - 1 : idx;
        var ring = Math.floor(k / CONFIG.angular) + 1;
        var ang  = (k % CONFIG.angular) * (2 * Math.PI / CONFIG.angular);
        var r    = ring * CONFIG.spacing;
        return { ring: ring, px: CX + r * Math.cos(ang), py: CY + r * Math.sin(ang) };
    }

    // =================================================================
    // カラーパレット文字列（エクスプレッションに焼く）
    // =================================================================
    function palStr() {
        var s = "[";
        for (var p = 0; p < CONFIG.palette.length; p++) {
            var c = CONFIG.palette[p];
            s += "[" + c[0] + "," + c[1] + "," + c[2] + "," + c[3] + "]";
            if (p < CONFIG.palette.length - 1) s += ",";
        }
        return s + "]";
    }

    // =================================================================
    // スケールエクスプレッション（グループの ADBE Vector Scale 用）
    // px/py/mr/di はそれぞれのドットの値をコードに直接焼き込む
    // =================================================================
    function scaleExpr(info, di) {
        return "" +
            "var px=" + info.px.toFixed(2) + ";var py=" + info.py.toFixed(2) + ";\n" +
            "var mr=" + info.ring + ";var di=" + di + ";\n" +
            "var f=thisComp.layer(\"DOT_FIELD\");\n" +
            "var rc=Math.round(f.effect(\"Ring Count\")(\"Slider\"));\n" +
            "if(mr>rc){[0,0];}else{\n" +
            "  var m=f.transform.position;\n" +
            "  var rad=Math.max(f.effect(\"Radius\")(\"Slider\"),1);\n" +
            "  var mx=f.effect(\"Max Scale\")(\"Slider\");\n" +
            "  var bs=f.effect(\"Base Scale\")(\"Slider\");\n" +
            "  var fo=Math.max(f.effect(\"Falloff\")(\"Slider\"),0.01);\n" +
            "  var vr=f.effect(\"Variation\")(\"Slider\");\n" +
            "  var sd=f.effect(\"Seed\")(\"Slider\");\n" +
            "  var d=length([px,py],m);\n" +
            "  var infl=Math.pow(clamp(1-d/rad,0,1),fo);\n" +
            "  var sc=linear(infl,0,1,bs,mx);\n" +
            "  seedRandom(di+sd,true);\n" +
            "  sc=sc*(1+random(-1,1)*(vr/100));\n" +
            "  [sc,sc];\n" +
            "}";
    }

    // =================================================================
    // カラーエクスプレッション（グループの Fill Color 用）
    // =================================================================
    function colorExpr(info, di) {
        return "" +
            "var px=" + info.px.toFixed(2) + ";var py=" + info.py.toFixed(2) + ";\n" +
            "var mr=" + info.ring + ";var di=" + di + ";\n" +
            "var pal=" + palStr() + ";\n" +
            "var f=thisComp.layer(\"DOT_FIELD\");\n" +
            "var rc=Math.round(f.effect(\"Ring Count\")(\"Slider\"));\n" +
            "if(mr>rc){[0,0,0,1];}else{\n" +
            "  var m=f.transform.position;\n" +
            "  var rad=Math.max(f.effect(\"Radius\")(\"Slider\"),1);\n" +
            "  var fo=Math.max(f.effect(\"Falloff\")(\"Slider\"),0.01);\n" +
            "  var ca=f.effect(\"Color Amount\")(\"Slider\")/100;\n" +
            "  var sd=f.effect(\"Seed\")(\"Slider\");\n" +
            "  seedRandom(di+sd+7,true);\n" +
            "  var col=pal[Math.floor(random(0,pal.length))];\n" +
            "  var d=length([px,py],m);\n" +
            "  var infl=Math.pow(clamp(1-d/rad,0,1),fo)*ca;\n" +
            "  var k=[0,0,0];\n" +
            "  [linear(infl,0,1,k[0],col[0]),linear(infl,0,1,k[1],col[1]),linear(infl,0,1,k[2],col[2]),1];\n" +
            "}";
    }

    // =================================================================
    // ヘルパ
    // =================================================================
    function addSlider(layer, name, val) {
        var s = layer.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
        s.name = name;
        s.property("ADBE Slider Control-0001").setValue(val);
    }

    function removeExistingComp(proj, name) {
        for (var idx = proj.items.length; idx >= 1; idx--) {
            var item = proj.items[idx];
            if (item instanceof CompItem && item.name === name) item.remove();
        }
    }

    // =================================================================
    // 生成本体
    // =================================================================
    function build() {
        var proj = app.project;
        if (!proj) { alert("プロジェクトが開いていません。"); return; }

        // 重複防止
        var has = false;
        for (var ci = 1; ci <= proj.items.length; ci++) {
            if (proj.items[ci] instanceof CompItem && proj.items[ci].name === CONFIG.compName) {
                has = true; break;
            }
        }
        if (has) {
            if (!confirm("「" + CONFIG.compName + "」が既に存在します。\n削除して新たに生成しますか？")) return;
            removeExistingComp(proj, CONFIG.compName);
        }

        var comp = proj.items.addComp(
            CONFIG.compName, CONFIG.compW, CONFIG.compH, 1, CONFIG.duration, CONFIG.fps);
        comp.openInViewer();

        // ── 背景 ──────────────────────────────────
        var bg = comp.layers.addSolid(CONFIG.bgColor, "BG", CONFIG.compW, CONFIG.compH, 1);
        bg.locked = true;

        // ── コントロールヌル（DOT_FIELD）────────────
        var ctrl = comp.layers.addNull();
        ctrl.name = "DOT_FIELD";
        ctrl.label = 11;
        ctrl.property("ADBE Transform Group").property("ADBE Position").setValue([CX, CY]);
        addSlider(ctrl, "Ring Count",   CONFIG.ringCount);
        addSlider(ctrl, "Radius",       CONFIG.radius);
        addSlider(ctrl, "Max Scale",    CONFIG.maxScale);
        addSlider(ctrl, "Base Scale",   CONFIG.baseScale);
        addSlider(ctrl, "Falloff",      CONFIG.falloff);
        addSlider(ctrl, "Color Amount", CONFIG.colorAmount);
        addSlider(ctrl, "Variation",    CONFIG.variation);
        addSlider(ctrl, "Seed",         CONFIG.seed);

        // ── 全ドットを1枚のシェイプレイヤーに ──────
        // addShape() のデフォルト: position=[CX,CY], anchor=[0,0]
        // → グループ position [dx,dy] がコンプ上の [CX+dx, CY+dy] に対応
        var shp = comp.layers.addShape();
        shp.name = "DotField";

        var root = shp.property("ADBE Root Vectors Group");
        var total = CONFIG.rings * CONFIG.angular + (CONFIG.addCenter ? 1 : 0);

        for (var i = 0; i < total; i++) {
            var info = gridInfo(i);
            var grp  = root.addProperty("ADBE Vector Group");
            var gc   = grp.property("ADBE Vectors Group");

            // 楕円
            var ell = gc.addProperty("ADBE Vector Shape - Ellipse");
            ell.property("ADBE Vector Ellipse Size").setValue([CONFIG.dotSize, CONFIG.dotSize]);

            // フィル
            var fill  = gc.addProperty("ADBE Vector Graphic - Fill");
            var fillC = fill.property("ADBE Vector Fill Color");
            fillC.setValue([0, 0, 0, 1]);
            fillC.expression = colorExpr(info, i);

            // グループ変換（位置を焼く・スケールをエクスプレッションで制御）
            var gt = grp.property("ADBE Vector Transform Group");
            gt.property("ADBE Vector Position").setValue([info.px - CX, info.py - CY]);
            gt.property("ADBE Vector Scale").expression = scaleExpr(info, i);
        }

        ctrl.moveToBeginning();
        alert(
            "DotMagnet を生成しました！\n\n" +
            "レイヤーは 3 枚だけです:\n" +
            "  DOT_FIELD … ヌルを動かすとドットが反応\n" +
            "  DotField  … 全ドット入りシェイプレイヤー\n" +
            "  BG        … 白背景\n\n" +
            "DOT_FIELD のスライダーで動きを自在に調整できます。"
        );
    }

    // =================================================================
    // 実行
    // =================================================================
    function run() {
        if (!app) { alert("After Effects で実行してください。"); return; }
        app.beginUndoGroup("Generate DotMagnet");
        try { build(); }
        catch (err) { alert("エラー:\n" + err.toString() + "\n(line " + (err.line || "?") + ")"); }
        finally { app.endUndoGroup(); }
    }

    if (thisObj instanceof Panel ||
        (thisObj && thisObj.toString && thisObj.toString() === "[object Panel]")) {
        var btn = thisObj.add("button", undefined, "Generate DotMagnet");
        btn.onClick = run;
        thisObj.layout.layout(true);
    } else {
        run();
    }

})(this);
