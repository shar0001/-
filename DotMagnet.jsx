/**********************************************************************
 * DotMagnet.jsx
 * --------------------------------------------------------------------
 * 円状（極座標グリッド）に並んだドット群が、1つのヌル「DOT_FIELD」に
 * 近づくとサイズと色が変化する、インタラクティブなフィールドを
 * After Effects に生成するスクリプト。
 *
 *   ・DOT_FIELD ヌルを動かす  → 近くのドットだけ大きくなり、色がつく
 *   ・DOT_FIELD のスライダー  → 影響範囲・サイズ・色の強さ・ランダム量を
 *                               すべて自在にコントロール
 *
 * 生成されるコントロール（DOT_FIELD 上のスライダー）:
 *   Radius        … 影響範囲(px)。これ以内のドットが反応
 *   Max Scale     … ヌル中心での最大サイズ(%)
 *   Base Scale    … 範囲外（遠い）ドットのサイズ(%)
 *   Falloff       … 反応の鋭さ（大きいほど中心付近だけ反応）
 *   Color Amount  … 近づいたとき色がつく強さ(%)
 *   Variation     … ドットごとのサイズのランダムばらつき(%)
 *   Seed          … 乱数の種。スクラブするとランダムパターンが変わる
 *
 * 使い方:
 *   File > Scripts > Run Script File... から本ファイルを実行。
 *   DotMagnet コンプが生成されるので、DOT_FIELD ヌルを動かして
 *   みてください（位置にキーフレームを打てばアニメーションになります）。
 *
 * 注意: DOT_FIELD は親（ペアレント）を付けないでください
 *       （コンプ座標で距離を測っているため）。
 **********************************************************************/

(function DotMagnet(thisObj) {

    // =================================================================
    // CONFIG
    // =================================================================
    var CONFIG = {
        compName:   "DotMagnet",
        compW:      1080,
        compH:      1080,
        fps:        30,
        duration:   10,

        rings:      11,        // 同心円の数
        angular:    24,        // 1リングあたりのドット数
        spacing:    40,        // リング間の距離(px)
        addCenter:  true,

        dotSize:    18,        // シェイプ実寸(px)

        // スライダー初期値
        radius:     320,
        maxScale:   320,
        baseScale:  35,
        falloff:    1.5,
        colorAmount:100,
        variation:  0,
        seed:       0,

        palette: [
            [0.12, 0.45, 0.85, 1],   // 青
            [0.55, 0.80, 0.95, 1],   // 水色
            [0.30, 0.85, 0.95, 1],   // シアン
            [0.98, 0.82, 0.18, 1],   // 黄
            [0.78, 0.74, 0.95, 1],   // 薄紫
            [0.05, 0.12, 0.25, 1]    // 紺
        ],
        bgColor: [1, 1, 1]
    };

    // =================================================================
    // エクスプレッション（全ドット共通。index で個体差を出す）
    // =================================================================
    function scaleExpr() {
        return "" +
            "var c=thisComp.layer(\"DOT_FIELD\");\n" +
            "var m=c.transform.position;\n" +
            "var rad=Math.max(c.effect(\"Radius\")(\"Slider\"),1);\n" +
            "var mx=c.effect(\"Max Scale\")(\"Slider\");\n" +
            "var bs=c.effect(\"Base Scale\")(\"Slider\");\n" +
            "var fo=Math.max(c.effect(\"Falloff\")(\"Slider\"),0.01);\n" +
            "var vr=c.effect(\"Variation\")(\"Slider\");\n" +
            "var sd=c.effect(\"Seed\")(\"Slider\");\n" +
            "var p=transform.position;\n" +
            "var d=length(p,m);\n" +
            "var infl=Math.pow(clamp(1-d/rad,0,1),fo);\n" +
            "var sc=linear(infl,0,1,bs,mx);\n" +
            "seedRandom(index+sd,true);\n" +
            "sc*=1+random(-1,1)*(vr/100);\n" +
            "[sc,sc];";
    }

    function colorExpr() {
        var ps = "[";
        for (var p = 0; p < CONFIG.palette.length; p++) {
            var c = CONFIG.palette[p];
            ps += "[" + c[0] + "," + c[1] + "," + c[2] + "," + c[3] + "]";
            if (p < CONFIG.palette.length - 1) ps += ",";
        }
        ps += "]";
        return "" +
            "var c=thisComp.layer(\"DOT_FIELD\");\n" +
            "var m=c.transform.position;\n" +
            "var rad=Math.max(c.effect(\"Radius\")(\"Slider\"),1);\n" +
            "var fo=Math.max(c.effect(\"Falloff\")(\"Slider\"),0.01);\n" +
            "var ca=c.effect(\"Color Amount\")(\"Slider\")/100;\n" +
            "var sd=c.effect(\"Seed\")(\"Slider\");\n" +
            "var pal=" + ps + ";\n" +
            "seedRandom(index+sd+7,true);\n" +
            "var col=pal[Math.floor(random(0,pal.length))];\n" +
            "var p=transform.position;\n" +
            "var d=length(p,m);\n" +
            "var infl=Math.pow(clamp(1-d/rad,0,1),fo)*ca;\n" +
            "var k=[0,0,0,1];\n" +
            "[linear(infl,0,1,k[0],col[0]),linear(infl,0,1,k[1],col[1]),linear(infl,0,1,k[2],col[2]),1];";
    }

    // =================================================================
    // ヘルパ
    // =================================================================
    function addSlider(layer, name, val) {
        var s = layer.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
        s.name = name;
        s.property("ADBE Slider Control-0001").setValue(val);
        return s;
    }

    function gridPos(idx) {
        var cx = CONFIG.compW / 2, cy = CONFIG.compH / 2;
        if (CONFIG.addCenter && idx === 0) return [cx, cy];
        var k = CONFIG.addCenter ? idx - 1 : idx;
        var ring = Math.floor(k / CONFIG.angular) + 1;
        var ang  = (k % CONFIG.angular) * (2 * Math.PI / CONFIG.angular);
        var r = ring * CONFIG.spacing;
        return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
    }

    function zeroPad(n, w) {
        var s = String(n);
        while (s.length < w) s = "0" + s;
        return s;
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
            var it = proj.items[ci];
            if (it instanceof CompItem && it.name === CONFIG.compName) { has = true; break; }
        }
        if (has) {
            if (!confirm("「" + CONFIG.compName + "」が既に存在します。\n削除して新たに生成しますか？")) return;
            removeExistingComp(proj, CONFIG.compName);
        }

        var comp = proj.items.addComp(
            CONFIG.compName, CONFIG.compW, CONFIG.compH, 1, CONFIG.duration, CONFIG.fps);
        comp.openInViewer();

        // 背景
        var bg = comp.layers.addSolid(CONFIG.bgColor, "BG", CONFIG.compW, CONFIG.compH, 1);
        bg.locked = true;

        // コントロール兼マグネット用ヌル
        var ctrl = comp.layers.addNull();
        ctrl.name = "DOT_FIELD";
        ctrl.label = 11;
        ctrl.property("ADBE Transform Group").property("ADBE Position")
            .setValue([CONFIG.compW / 2, CONFIG.compH / 2]);
        addSlider(ctrl, "Radius",       CONFIG.radius);
        addSlider(ctrl, "Max Scale",    CONFIG.maxScale);
        addSlider(ctrl, "Base Scale",   CONFIG.baseScale);
        addSlider(ctrl, "Falloff",      CONFIG.falloff);
        addSlider(ctrl, "Color Amount", CONFIG.colorAmount);
        addSlider(ctrl, "Variation",    CONFIG.variation);
        addSlider(ctrl, "Seed",         CONFIG.seed);

        var sExpr = scaleExpr();
        var cExpr = colorExpr();

        // ドット生成
        var total = CONFIG.rings * CONFIG.angular + (CONFIG.addCenter ? 1 : 0);
        for (var i = 0; i < total; i++) {
            var lyr  = comp.layers.addShape();
            lyr.name = "dot_" + zeroPad(i, 4);

            var root = lyr.property("ADBE Root Vectors Group");
            var grp  = root.addProperty("ADBE Vector Group");
            var gc   = grp.property("ADBE Vectors Group");

            var ell = gc.addProperty("ADBE Vector Shape - Ellipse");
            ell.property("ADBE Vector Ellipse Size").setValue([CONFIG.dotSize, CONFIG.dotSize]);

            var fill  = gc.addProperty("ADBE Vector Graphic - Fill");
            var fillC = fill.property("ADBE Vector Fill Color");
            fillC.setValue([0, 0, 0, 1]);

            var tr = lyr.property("ADBE Transform Group");
            // 位置は静的に焼く（円状グリッド）
            tr.property("ADBE Position").setValue(gridPos(i));
            // サイズと色は DOT_FIELD への近さで変化
            tr.property("ADBE Scale").expression = sExpr;
            fillC.expression                     = cExpr;
        }

        ctrl.moveToBeginning();
        alert("DotMagnet を生成しました！\n\nDOT_FIELD ヌルを動かすと近くのドットが反応します。\nDOT_FIELD のスライダーで影響範囲・サイズ・色・ランダム量を調整できます。");
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
