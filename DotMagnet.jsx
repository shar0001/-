/**********************************************************************
 * DotMagnet.jsx  v4
 * --------------------------------------------------------------------
 * 改修ポイント:
 *  (1) コントローラーをヌル名に依存せず自動検出（"Radius" スライダーを
 *      持つレイヤーを探す）。名前が "DOT_FIELD" でなくても動く。
 *  (2) 配置を均一な円形分布に変更（外側リングほどドット数を増やす）。
 *  (3) サイズは楕円「サイズ」プロパティで駆動（確実に評価される）。
 *
 * レイヤー構成: BG / DotField(全ドット1枚) / DOT_FIELD(ヌル)
 *
 * スライダー（DOT_FIELD）:
 *   Ring Count    … 表示するリング数(0=全消し, 11=全表示)
 *   Radius        … ヌルの影響範囲(px)
 *   Max Scale     … ヌル中心での最大サイズ(%)
 *   Base Scale    … 遠いドットの最小サイズ(%)
 *   Falloff       … 反応の鋭さ
 *   Color Amount  … 色のつき方(%) 0=黒のまま
 *   Variation     … ドットごとのサイズばらつき(%)
 *   Seed          … ランダムの種
 *
 * 推奨実行方法:
 *   ファイル > スクリプト > スクリプトファイルを実行 → 本ファイル
 *   （パネルはAE起動時のコードを保持するため、更新後はこの方法が確実）
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

        rings:       11,      // 同心円の数
        angularBase: 4,       // リングkのドット数 = angularBase*k（均一分布）
        spacing:     40,      // リング間の距離(px)
        addCenter:   true,

        dotSize:     18,      // 基準サイズ(px)。スライダー100%のときの直径

        // スライダー初期値
        ringCount:   11,
        radius:      300,
        maxScale:    320,
        baseScale:   35,
        falloff:     2.0,
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
    // ドット一覧（均一な円形分布）
    // =================================================================
    function buildDotList() {
        var list = [];
        var di = 0;
        if (CONFIG.addCenter) list.push({ ring: 0, px: CX, py: CY, di: di++ });
        for (var ring = 1; ring <= CONFIG.rings; ring++) {
            var n = CONFIG.angularBase * ring;          // 外側ほど多い
            var r = ring * CONFIG.spacing;
            for (var j = 0; j < n; j++) {
                var ang = j * (2 * Math.PI / n);
                list.push({ ring: ring, px: CX + r * Math.cos(ang), py: CY + r * Math.sin(ang), di: di++ });
            }
        }
        return list;
    }

    function palStr() {
        var s = "[";
        for (var p = 0; p < CONFIG.palette.length; p++) {
            var c = CONFIG.palette[p];
            s += "[" + c[0] + "," + c[1] + "," + c[2] + "," + c[3] + "]";
            if (p < CONFIG.palette.length - 1) s += ",";
        }
        return s + "]";
    }

    // コントローラー自動検出コード（全エクスプレッション共通の先頭）
    function ctrlFinder() {
        return "" +
            "var f=null;\n" +
            "try{f=thisComp.layer(\"DOT_FIELD\");}catch(e){}\n" +
            "if(f==null){for(var j=1;j<=thisComp.numLayers;j++){try{thisComp.layer(j).effect(\"Radius\")(\"Slider\");f=thisComp.layer(j);break;}catch(e2){}}}\n";
    }

    // 楕円サイズエクスプレッション
    function sizeExpr(info) {
        return "" +
            "var px=" + info.px.toFixed(2) + ";var py=" + info.py.toFixed(2) + ";\n" +
            "var mr=" + info.ring + ";var di=" + info.di + ";var ds=" + CONFIG.dotSize + ";\n" +
            ctrlFinder() +
            "var rc=Math.round(f.effect(\"Ring Count\")(\"Slider\"));\n" +
            "var m=f.transform.position;\n" +
            "var rad=Math.max(f.effect(\"Radius\")(\"Slider\"),1);\n" +
            "var mx=f.effect(\"Max Scale\")(\"Slider\")/100;\n" +
            "var bs=f.effect(\"Base Scale\")(\"Slider\")/100;\n" +
            "var fo=Math.max(f.effect(\"Falloff\")(\"Slider\"),0.01);\n" +
            "var vr=f.effect(\"Variation\")(\"Slider\");\n" +
            "var sd=f.effect(\"Seed\")(\"Slider\");\n" +
            "seedRandom(di+sd,true);\n" +
            "var vf=1+random(-1,1)*(vr/100);\n" +
            "var d=length([px,py],m);\n" +
            "var infl=Math.pow(clamp(1-d/rad,0,1),fo);\n" +
            "var sc=(mr>rc)?0:linear(infl,0,1,bs,mx)*vf;\n" +
            "var s=ds*sc;[s,s];";
    }

    // 色エクスプレッション
    function colorExpr(info) {
        return "" +
            "var px=" + info.px.toFixed(2) + ";var py=" + info.py.toFixed(2) + ";\n" +
            "var mr=" + info.ring + ";var di=" + info.di + ";\n" +
            "var pal=" + palStr() + ";\n" +
            ctrlFinder() +
            "var rc=Math.round(f.effect(\"Ring Count\")(\"Slider\"));\n" +
            "var m=f.transform.position;\n" +
            "var rad=Math.max(f.effect(\"Radius\")(\"Slider\"),1);\n" +
            "var fo=Math.max(f.effect(\"Falloff\")(\"Slider\"),0.01);\n" +
            "var ca=f.effect(\"Color Amount\")(\"Slider\")/100;\n" +
            "var sd=f.effect(\"Seed\")(\"Slider\");\n" +
            "seedRandom(di+sd+7,true);\n" +
            "var col=pal[Math.floor(random(0,pal.length))];\n" +
            "var d=length([px,py],m);\n" +
            "var infl=(mr>rc)?0:Math.pow(clamp(1-d/rad,0,1),fo)*ca;\n" +
            "[linear(infl,0,1,0,col[0]),linear(infl,0,1,0,col[1]),linear(infl,0,1,0,col[2]),1];";
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

        var has = false;
        for (var ci = 1; ci <= proj.items.length; ci++) {
            if (proj.items[ci] instanceof CompItem && proj.items[ci].name === CONFIG.compName) { has = true; break; }
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

        // DOT_FIELD ヌル
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

        // 全ドットを1枚のシェイプレイヤーに
        var shp = comp.layers.addShape();
        shp.name = "DotField";
        var root = shp.property("ADBE Root Vectors Group");

        var dots = buildDotList();
        for (var i = 0; i < dots.length; i++) {
            var info = dots[i];
            var grp  = root.addProperty("ADBE Vector Group");
            var gc   = grp.property("ADBE Vectors Group");

            var ell     = gc.addProperty("ADBE Vector Shape - Ellipse");
            var ellSize = ell.property("ADBE Vector Ellipse Size");
            ellSize.setValue([CONFIG.dotSize, CONFIG.dotSize]);
            ellSize.expression = sizeExpr(info);

            var fill  = gc.addProperty("ADBE Vector Graphic - Fill");
            var fillC = fill.property("ADBE Vector Fill Color");
            fillC.setValue([0, 0, 0, 1]);
            fillC.expression = colorExpr(info);

            var gt = grp.property("ADBE Vector Transform Group");
            gt.property("ADBE Vector Position").setValue([info.px - CX, info.py - CY]);
        }

        ctrl.moveToBeginning();
        alert(
            "DotMagnet v4 を生成しました！（ドット数 " + dots.length + "）\n\n" +
            "DOT_FIELD ヌルを動かすと近くのドットが反応します。\n" +
            "反応しない時は Radius を大きく / Max Scale を上げてください。"
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
