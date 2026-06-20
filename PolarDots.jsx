/**********************************************************************
 * PolarDots.jsx
 * --------------------------------------------------------------------
 * 極座標グリッド上のドットが、State（状態）の切り替えに合わせて
 * 滑らかに変化するジェネラティブ・モーショングラフィックスを
 * After Effects 上に一発生成するスクリプトです。
 *
 * 状態シーケンス:
 *   State 0 : RANDOM      … 円内にランダム配置・極小・黒
 *   State 1 : SIMPLICITY  … 同心円グリッドに整列・均一サイズ・黒
 *   State 2 : SPACE       … 一部のドットだけが拡大（時間で移り変わる）
 *   State 3 : IMPERFECT   … 中層の1リングだけが一斉に拡大
 *   State 4 : VIVID       … マルチカラー＋ノイズでサイズが明滅
 *
 * 使い方:
 *   1. After Effects を起動
 *   2. File > Scripts > Run Script File... から本ファイルを選択
 *      （または ScriptUI Panels に入れてパネル実行）
 *   3. コンポが生成され、DOT_CTRL の "State" スライダーが
 *      0→4 にキーフレームされた状態で開きます
 *   4. RAM プレビュー（スペース/0キー）で全シーケンスを確認
 *
 * 調整:
 *   - 下の CONFIG を書き換えるだけで、ドット数・リング数・間隔・
 *     色パレット・サイズ・コンポ設定を変更できます。
 *   - 生成後は DOT_CTRL の "State" スライダーのキーフレームを
 *     動かすだけで演出のタイミングを自由に編集できます。
 **********************************************************************/

(function PolarDots(thisObj) {

    // =================================================================
    // CONFIG  ── ここを書き換えるだけで見た目を調整できます
    // =================================================================
    var CONFIG = {
        // --- コンポ設定 ---
        compName:   "PolarDots",
        compW:      1080,
        compH:      1080,
        fps:        30,
        duration:   14,            // 秒

        // --- グリッド設定 ---
        rings:      11,            // 同心円の数（中心点を除く）
        angular:    24,            // 1リングあたりのドット数（＝スポーク数）
        spacing:    40,            // リング間の距離(px)
        addCenter:  true,          // 中心に1点置くか

        // --- ドットの基本サイズ ---
        dotSize:    18,            // シェイプ実寸(px)。スケール100%時の直径
        baseScale:  100,           // SIMPLICITY時の基準スケール(%)

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
            [0.0, 0],   // RANDOM
            [1.0, 1],   // → SIMPLICITY
            [3.0, 1],
            [4.0, 2],   // → SPACE
            [6.0, 2],
            [7.0, 3],   // → IMPERFECT
            [9.0, 3],
            [10.0, 4],  // → VIVID
            [13.5, 4]
        ]
    };

    // =================================================================
    // エクスプレッション生成（ドットごとに index を焼き込む）
    // =================================================================

    // 全エクスプレッション共通の定数ヘッダーを作る
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
            "var ctrl = thisComp.layer(\"DOT_CTRL\");\n" +
            "var s = ctrl.effect(\"State\")(\"Slider\");\n" +
            "var t = time;\n";
    }

    // 位置エクスプレッション
    function posExpr(i) {
        return commonHeader(i) +
            "function ringOf(idx){ if(addC && idx==0) return 0; var k=addC?idx-1:idx; return Math.floor(k/A)+1; }\n" +
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
            "}\n" +
            "function posForState(st, idx){ return (st<=0) ? randPos(idx) : gridPos(idx); }\n" +
            "var s0 = Math.floor(s); var s1 = Math.min(s0+1,4); var f = ease(s-s0,0,1);\n" +
            "var p0 = posForState(s0,i); var p1 = posForState(s1,i);\n" +
            "[linear(f,0,1,p0[0],p1[0]), linear(f,0,1,p0[1],p1[1])];";
    }

    // スケールエクスプレッション
    function scaleExpr(i) {
        return commonHeader(i) +
            "function ringOf(idx){ if(addC && idx==0) return 0; var k=addC?idx-1:idx; return Math.floor(k/A)+1; }\n" +
            "function scaleForState(st, idx){\n" +
            "  if(st==0){ seedRandom(idx+99,true); return baseS*random(0.30,0.55); }\n" +   // RANDOM 極小
            "  if(st==1){ return baseS; }\n" +                                              // SIMPLICITY 均一
            "  if(st==2){\n" +                                                              // SPACE 動く選択
            "    var phase = Math.sin(t*0.9 + idx*0.55);\n" +
            "    return (phase > 0.82) ? baseS*3.0 : baseS*0.45;\n" +
            "  }\n" +
            "  if(st==3){\n" +                                                              // IMPERFECT 1リング拡大
            "    var selRing = 3 + Math.round((1+Math.sin(t*0.35))*1.5);\n" +               // 3〜6 をゆっくり移動
            "    return (ringOf(idx)==selRing) ? baseS*2.8 : baseS*0.45;\n" +
            "  }\n" +
            "  // st==4 VIVID ノイズ明滅\n" +
            "  seedRandom(idx,true); var off=random(0,100);\n" +
            "  var nz = (Math.sin(t*1.5+off) + Math.sin(t*0.6+off*1.3))*0.5;\n" +           // -1..1
            "  return baseS*(1.0 + nz*0.85);\n" +
            "}\n" +
            "var s0 = Math.floor(s); var s1 = Math.min(s0+1,4); var f = ease(s-s0,0,1);\n" +
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
            "  if(st<4) return black;\n" +
            "  seedRandom(idx+7,true);\n" +
            "  return pal[Math.floor(random(0,pal.length))];\n" +
            "}\n" +
            "var s0 = Math.floor(s); var s1 = Math.min(s0+1,4); var f = ease(s-s0,0,1);\n" +
            "var c0 = colForState(s0,i); var c1 = colForState(s1,i);\n" +
            "[linear(f,0,1,c0[0],c1[0]), linear(f,0,1,c0[1],c1[1]), linear(f,0,1,c0[2],c1[2]), 1];";
    }

    // =================================================================
    // 生成本体
    // =================================================================
    function build() {
        var proj = app.project || app.newProject();

        // --- コンポ作成 ---
        var comp = proj.items.addComp(
            CONFIG.compName, CONFIG.compW, CONFIG.compH,
            1, CONFIG.duration, CONFIG.fps
        );
        comp.openInViewer();

        // --- 背景（白ソリッド）---
        var bg = comp.layers.addSolid(CONFIG.bgColor, "BG", CONFIG.compW, CONFIG.compH, 1);
        bg.locked = true;

        // --- コントローラー Null ---
        var ctrl = comp.layers.addNull();
        ctrl.name = "DOT_CTRL";
        ctrl.label = 9; // 目立つラベル色
        var slider = ctrl.property("ADBE Effect Parade")
                         .addProperty("ADBE Slider Control");
        slider.name = "State";
        var stateProp = slider.property("ADBE Slider Control-0001");

        // State スライダーにデモ用キーフレーム＋イージング
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

        // --- ドット総数 ---
        var total = CONFIG.rings * CONFIG.angular + (CONFIG.addCenter ? 1 : 0);

        // --- ドット生成 ---
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

            // エクスプレッション適用
            var tr = lyr.property("ADBE Transform Group");
            tr.property("ADBE Position").expression = posExpr(i);
            tr.property("ADBE Scale").expression    = scaleExpr(i);
            fillColor.expression                    = colorExpr(i);
        }

        // DOT_CTRL / BG を最前面に整理
        ctrl.moveToBeginning();

        return comp;
    }

    function zeroPad(n, width) {
        var s = String(n);
        while (s.length < width) s = "0" + s;
        return s;
    }

    // =================================================================
    // 実行（Undo グループでまとめる）
    // =================================================================
    function run() {
        if (!app) { alert("After Effects で実行してください。"); return; }
        app.beginUndoGroup("Generate PolarDots");
        try {
            build();
        } catch (err) {
            alert("生成中にエラーが発生しました:\n" + err.toString() +
                  "\n(line " + (err.line || "?") + ")");
        } finally {
            app.endUndoGroup();
        }
    }

    // ScriptUI パネルとして開かれた場合は簡易ボタン、
    // それ以外（Run Script File）は即実行
    if (thisObj instanceof Panel || (thisObj && thisObj.toString && thisObj.toString() === "[object Panel]")) {
        var pal = thisObj;
        var btn = pal.add("button", undefined, "Generate PolarDots");
        btn.onClick = run;
        pal.layout.layout(true);
    } else {
        run();
    }

})(this);
