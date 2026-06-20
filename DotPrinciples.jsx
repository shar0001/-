/**********************************************************************
 * DotPrinciples.jsx
 * --------------------------------------------------------------------
 * 極座標グリッド上のドット群が、デザイン原則（Design Principles）を
 * 表す 6 つの State を滑らかに行き来するジェネラティブ・アニメーションを
 * After Effects 上に一発生成するスクリプトです。
 *
 * ※ PolarDots.jsx の発展版。参考画像5枚をもとに、以下を新規追加:
 *    - EMERGE 状態（数個だけ残り、他はスケール0から発生）
 *    - SPACE 対称型（最外周の対称点だけがゆっくり回転しながら拡大）
 *
 * 状態シーケンス:
 *   State 0 : EMERGE      … ほぼ全消し、数個だけ可視（発生/消散）
 *   State 1 : RANDOM      … 円内ランダム配置・極小・黒
 *   State 2 : SIMPLICITY  … 同心円グリッドに整列・均一・黒
 *   State 3 : SPACE       … 最外周の対称点＋散財する数個だけ拡大
 *   State 4 : IMPERFECT   … 中層の1リングだけが一斉に拡大
 *   State 5 : VIVID       … マルチカラー＋ノイズでサイズが明滅
 *
 * 使い方:
 *   1. After Effects を起動
 *   2. File > Scripts > Run Script File... から本ファイルを選択
 *   3. コンポが生成され、DOT_CTRL の "State"(0..5) がキーフレーム済みで開く
 *   4. RAM プレビューで全シーケンスを確認
 *
 * 調整:
 *   - 下の CONFIG を書き換えるだけで全パラメータを変更できます。
 *   - 生成後は DOT_CTRL の "State" スライダーのキーフレームで自由に再編集。
 **********************************************************************/

(function DotPrinciples(thisObj) {

    // =================================================================
    // CONFIG  ── ここを書き換えるだけで見た目を調整できます
    // =================================================================
    var CONFIG = {
        // --- コンポ設定 ---
        compName:   "DotPrinciples",
        compW:      1080,
        compH:      1080,
        fps:        30,
        duration:   16,            // 秒

        // --- グリッド設定 ---
        rings:      11,            // 同心円の数（中心点を除く）
        angular:    24,            // 1リングあたりのドット数（＝スポーク数）
        spacing:    40,            // リング間の距離(px)
        addCenter:  true,          // 中心に1点置くか

        // --- ドットの基本サイズ ---
        dotSize:    18,            // シェイプ実寸(px)。スケール100%時の直径
        baseScale:  100,           // SIMPLICITY時の基準スケール(%)

        // --- SPACE 対称型の設定 ---
        spaceSymCount: 6,          // 最外周で同時に大きくする対称点の数
        spaceSymSpeed: 0.5,        // 対称点が回転する速さ

        // --- EMERGE で残すドットの割合 ---
        emergeKeepRatio: 0.045,    // 0.045 = 約4.5%だけ可視

        // --- 色（RGBA 0..1）---
        palette: [
            [0.12, 0.45, 0.85, 1],   // 青
            [0.55, 0.80, 0.95, 1],   // 水色
            [0.30, 0.85, 0.95, 1],   // シアン
            [0.98, 0.82, 0.18, 1],   // 黄
            [0.78, 0.74, 0.95, 1],   // 薄紫
            [0.05, 0.12, 0.25, 1],   // 紺
            [0.00, 0.00, 0.00, 1]    // 黒
        ],
        bgColor: [1, 1, 1],          // 背景（白）

        // --- State スライダーのデモ用キーフレーム [時間(秒), 値] ---
        stateKeys: [
            [0.0, 0],   // EMERGE
            [1.5, 1],   // → RANDOM
            [3.0, 2],   // → SIMPLICITY
            [4.5, 2],
            [5.5, 3],   // → SPACE
            [7.5, 3],
            [8.5, 4],   // → IMPERFECT
            [10.5, 4],
            [11.5, 5],  // → VIVID
            [15.5, 5]
        ]
    };

    var MAXSTATE = 5;

    // =================================================================
    // エクスプレッション生成（ドットごとに index を焼き込む）
    // =================================================================

    function commonHeader(i) {
        return "" +
            "var i = " + i + ";\n" +
            "var A = " + CONFIG.angular + ";\n" +
            "var R = " + CONFIG.rings + ";\n" +
            "var sp = " + CONFIG.spacing + ";\n" +
            "var cx = " + (CONFIG.compW / 2) + ";\n" +
            "var cy = " + (CONFIG.compH / 2) + ";\n" +
            "var baseS = " + CONFIG.baseScale + ";\n" +
            "var addC = " + (CONFIG.addCenter ? "1" : "0") + ";\n" +
            "var symN = " + CONFIG.spaceSymCount + ";\n" +
            "var symSpd = " + CONFIG.spaceSymSpeed + ";\n" +
            "var keepR = " + CONFIG.emergeKeepRatio + ";\n" +
            "var MS = " + MAXSTATE + ";\n" +
            "var ctrl = thisComp.layer(\"DOT_CTRL\");\n" +
            "var s = ctrl.effect(\"State\")(\"Slider\");\n" +
            "var t = time;\n";
    }

    // 共通のジオメトリ関数（位置・スケール両方で使う）
    function geomFns() {
        return "" +
            "function ringOf(idx){ if(addC && idx==0) return 0; var k=addC?idx-1:idx; return Math.floor(k/A)+1; }\n" +
            "function angIdx(idx){ if(addC && idx==0) return -1; var k=addC?idx-1:idx; return k%A; }\n" +
            "function gridPos(idx){\n" +
            "  if(addC && idx==0) return [cx,cy];\n" +
            "  var k = addC ? idx-1 : idx;\n" +
            "  var ring = Math.floor(k/A)+1;\n" +
            "  var ang  = (k%A) * (2*Math.PI/A);\n" +
            "  var r = ring*sp;\n" +
            "  return [cx + r*Math.cos(ang), cy + r*Math.sin(ang)];\n" +
            "}\n" +
            "function randPos(idx){\n" +
            "  seedRandom(idx+1234, true);\n" +
            "  var rr = Math.sqrt(random()) * (R*sp);\n" +   // 円内一様分布
            "  var aa = random(0, 2*Math.PI);\n" +
            "  return [cx + rr*Math.cos(aa), cy + rr*Math.sin(aa)];\n" +
            "}\n";
    }

    // 位置エクスプレッション
    function posExpr(i) {
        return commonHeader(i) + geomFns() +
            "function posForState(st, idx){ return (st<=1) ? randPos(idx) : gridPos(idx); }\n" +
            "var s0 = Math.floor(s); var s1 = Math.min(s0+1,MS); var f = ease(s-s0,0,1);\n" +
            "var p0 = posForState(s0,i); var p1 = posForState(s1,i);\n" +
            "[linear(f,0,1,p0[0],p1[0]), linear(f,0,1,p0[1],p1[1])];";
    }

    // スケールエクスプレッション
    function scaleExpr(i) {
        return commonHeader(i) + geomFns() +
            "function scaleForState(st, idx){\n" +
            "  if(st==0){ seedRandom(idx+555,true); return (random()<keepR) ? baseS*1.0 : 0; }\n" +      // EMERGE
            "  if(st==1){ seedRandom(idx+99,true); return baseS*random(0.30,0.50); }\n" +                // RANDOM
            "  if(st==2){ return baseS; }\n" +                                                            // SIMPLICITY
            "  if(st==3){\n" +                                                                            // SPACE
            "    var big = false;\n" +
            "    var a = angIdx(idx);\n" +
            "    if(ringOf(idx)==R && a>=0){\n" +                  // 最外周の対称点（ゆっくり回転）
            "      var step = A/symN;\n" +
            "      var off  = (t*symSpd) % step;\n" +
            "      var d = ((a - off) % step + step) % step;\n" +
            "      if(d < 0.5 || d > step-0.5) big = true;\n" +
            "    }\n" +
            "    var phase = Math.sin(t*0.9 + idx*0.55);\n" +      // 散財する数個
            "    if(phase > 0.9) big = true;\n" +
            "    return big ? baseS*2.8 : baseS*0.45;\n" +
            "  }\n" +
            "  if(st==4){\n" +                                                                            // IMPERFECT
            "    var selRing = 3 + Math.round((1+Math.sin(t*0.35))*2);\n" +                               // 3〜7 を移動
            "    return (ringOf(idx)==selRing) ? baseS*2.8 : baseS*0.45;\n" +
            "  }\n" +
            "  seedRandom(idx,true); var ofs=random(0,100);\n" +                                          // VIVID ノイズ明滅
            "  var nz = (Math.sin(t*1.5+ofs) + Math.sin(t*0.6+ofs*1.3))*0.5;\n" +
            "  return baseS*(1.0 + nz*0.85);\n" +
            "}\n" +
            "var s0 = Math.floor(s); var s1 = Math.min(s0+1,MS); var f = ease(s-s0,0,1);\n" +
            "var v = linear(f,0,1, scaleForState(s0,i), scaleForState(s1,i));\n" +
            "[v,v];";
    }

    // 色エクスプレッション（Fill Color に適用）
    function colorExpr(i) {
        var palStr = "[";
        for (var p = 0; p < CONFIG.palette.length; p++) {
            var c = CONFIG.palette[p];
            palStr += "[" + c[0] + "," + c[1] + "," + c[2] + "," + c[3] + "]";
            if (p < CONFIG.palette.length - 1) palStr += ",";
        }
        palStr += "]";

        return commonHeader(i) +
            "var black=[0,0,0,1];\n" +
            "var pal=" + palStr + ";\n" +
            "function colForState(st, idx){\n" +
            "  if(st<5) return black;\n" +
            "  seedRandom(idx+7,true);\n" +
            "  return pal[Math.floor(random(0,pal.length))];\n" +
            "}\n" +
            "var s0 = Math.floor(s); var s1 = Math.min(s0+1,MS); var f = ease(s-s0,0,1);\n" +
            "var c0 = colForState(s0,i); var c1 = colForState(s1,i);\n" +
            "[linear(f,0,1,c0[0],c1[0]), linear(f,0,1,c0[1],c1[1]), linear(f,0,1,c0[2],c1[2]), 1];";
    }

    // =================================================================
    // 生成本体
    // =================================================================
    function build() {
        var proj = app.project || app.newProject();

        var comp = proj.items.addComp(
            CONFIG.compName, CONFIG.compW, CONFIG.compH,
            1, CONFIG.duration, CONFIG.fps
        );
        comp.openInViewer();

        // 背景
        var bg = comp.layers.addSolid(CONFIG.bgColor, "BG", CONFIG.compW, CONFIG.compH, 1);
        bg.locked = true;

        // コントローラー
        var ctrl = comp.layers.addNull();
        ctrl.name = "DOT_CTRL";
        ctrl.label = 9;
        var slider = ctrl.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
        slider.name = "State";
        var stateProp = slider.property("ADBE Slider Control-0001");

        for (var k = 0; k < CONFIG.stateKeys.length; k++) {
            stateProp.setValueAtTime(CONFIG.stateKeys[k][0], CONFIG.stateKeys[k][1]);
        }
        var easeIn  = new KeyframeEase(0, 50);
        var easeOut = new KeyframeEase(0, 50);
        for (var ki = 1; ki <= stateProp.numKeys; ki++) {
            try {
                stateProp.setInterpolationTypeAtKey(ki,
                    KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
                stateProp.setTemporalEaseAtKey(ki, [easeIn], [easeOut]);
            } catch (e) {}
        }

        // ドット
        var total = CONFIG.rings * CONFIG.angular + (CONFIG.addCenter ? 1 : 0);
        for (var i = 0; i < total; i++) {
            var lyr = comp.layers.addShape();
            lyr.name = "dot_" + zeroPad(i, 4);

            var root    = lyr.property("ADBE Root Vectors Group");
            var grp     = root.addProperty("ADBE Vector Group");
            var grpCont = grp.property("ADBE Vectors Group");

            var ell = grpCont.addProperty("ADBE Vector Shape - Ellipse");
            ell.property("ADBE Vector Ellipse Size").setValue([CONFIG.dotSize, CONFIG.dotSize]);

            var fill = grpCont.addProperty("ADBE Vector Graphic - Fill");
            var fillColor = fill.property("ADBE Vector Fill Color");
            fillColor.setValue([0, 0, 0, 1]);

            var tr = lyr.property("ADBE Transform Group");
            tr.property("ADBE Position").expression = posExpr(i);
            tr.property("ADBE Scale").expression    = scaleExpr(i);
            fillColor.expression                    = colorExpr(i);
        }

        ctrl.moveToBeginning();
        return comp;
    }

    function zeroPad(n, width) {
        var s = String(n);
        while (s.length < width) s = "0" + s;
        return s;
    }

    // =================================================================
    // 実行
    // =================================================================
    function run() {
        if (!app) { alert("After Effects で実行してください。"); return; }
        app.beginUndoGroup("Generate DotPrinciples");
        try {
            build();
        } catch (err) {
            alert("生成中にエラーが発生しました:\n" + err.toString() +
                  "\n(line " + (err.line || "?") + ")");
        } finally {
            app.endUndoGroup();
        }
    }

    if (thisObj instanceof Panel || (thisObj && thisObj.toString && thisObj.toString() === "[object Panel]")) {
        var pal = thisObj;
        var btn = pal.add("button", undefined, "Generate DotPrinciples");
        btn.onClick = run;
        pal.layout.layout(true);
    } else {
        run();
    }

})(this);
