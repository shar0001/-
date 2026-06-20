/**********************************************************************
 * DesignWave.jsx
 * --------------------------------------------------------------------
 * 極座標グリッド上のドット群が 6 つの State を滑らかに行き来する
 * ジェネラティブ・アニメーションを After Effects に生成するスクリプト。
 *
 * State 0 : EMERGE      … 数個だけ可視（発生/消散）
 * State 1 : RANDOM      … 円内ランダム・極小・黒
 * State 2 : SIMPLICITY  … 同心円グリッドに整列・均一・黒
 * State 3 : SPACE       … 最外周の対称点（回転）＋散財する数個だけ拡大
 * State 4 : IMPERFECT   … 中層の1リングだけが一斉に拡大
 * State 5 : VIVID       … マルチカラー＋ノイズでサイズ明滅
 *
 * ※ 同名のコンプが既にある場合は確認ダイアログを出してから上書き。
 *   ボタンを何度押しても重複生成されません。
 *
 * 使い方:
 *   File > Scripts > Run Script File... から本ファイルを選択するか、
 *   ScriptUI Panels フォルダに入れて Window メニューから開く。
 *   「Generate DesignWave」ボタンを押すと DesignWave コンプが生成される。
 **********************************************************************/

(function DesignWave(thisObj) {

    // =================================================================
    // CONFIG
    // =================================================================
    var CONFIG = {
        compName:          "DesignWave",
        compW:             1080,
        compH:             1080,
        fps:               30,
        duration:          16,

        rings:             11,
        angular:           24,
        spacing:           40,
        addCenter:         true,

        dotSize:           18,
        baseScale:         100,

        spaceSymCount:     6,
        spaceSymSpeed:     0.5,
        emergeKeepRatio:   0.045,

        palette: [
            [0.12, 0.45, 0.85, 1],
            [0.55, 0.80, 0.95, 1],
            [0.30, 0.85, 0.95, 1],
            [0.98, 0.82, 0.18, 1],
            [0.78, 0.74, 0.95, 1],
            [0.05, 0.12, 0.25, 1],
            [0.00, 0.00, 0.00, 1]
        ],
        bgColor: [1, 1, 1],

        stateKeys: [
            [0.0, 0],
            [1.5, 1],
            [3.0, 2],
            [4.5, 2],
            [5.5, 3],
            [7.5, 3],
            [8.5, 4],
            [10.5, 4],
            [11.5, 5],
            [15.5, 5]
        ]
    };

    var MAXSTATE = 5;

    // =================================================================
    // エクスプレッション
    // =================================================================

    function hdr(i) {
        return "" +
            "var i=" + i + ";var A=" + CONFIG.angular + ";var R=" + CONFIG.rings + ";\n" +
            "var sp=" + CONFIG.spacing + ";var cx=" + (CONFIG.compW/2) + ";var cy=" + (CONFIG.compH/2) + ";\n" +
            "var baseS=" + CONFIG.baseScale + ";var addC=" + (CONFIG.addCenter?1:0) + ";\n" +
            "var symN=" + CONFIG.spaceSymCount + ";var symSpd=" + CONFIG.spaceSymSpeed + ";\n" +
            "var keepR=" + CONFIG.emergeKeepRatio + ";var MS=" + MAXSTATE + ";\n" +
            "var ctrl=thisComp.layer(\"WAVE_CTRL\");\n" +
            "var s=ctrl.effect(\"State\")(\"Slider\");var t=time;\n";
    }

    function geom() {
        return "" +
            "function ringOf(n){if(addC&&n==0)return 0;var k=addC?n-1:n;return Math.floor(k/A)+1;}\n" +
            "function angIdx(n){if(addC&&n==0)return -1;var k=addC?n-1:n;return k%A;}\n" +
            "function gridPos(n){\n" +
            "  if(addC&&n==0)return[cx,cy];\n" +
            "  var k=addC?n-1:n;var ring=Math.floor(k/A)+1;\n" +
            "  var ang=(k%A)*(2*Math.PI/A);var r=ring*sp;\n" +
            "  return[cx+r*Math.cos(ang),cy+r*Math.sin(ang)];\n" +
            "}\n" +
            "function randPos(n){\n" +
            "  seedRandom(n+1234,true);\n" +
            "  var rr=Math.sqrt(random())*(R*sp);var aa=random(0,2*Math.PI);\n" +
            "  return[cx+rr*Math.cos(aa),cy+rr*Math.sin(aa)];\n" +
            "}\n";
    }

    function posExpr(i) {
        return hdr(i) + geom() +
            "function pFS(st,n){return(st<=1)?randPos(n):gridPos(n);}\n" +
            "var s0=Math.floor(s);var s1=Math.min(s0+1,MS);var f=ease(s-s0,0,1);\n" +
            "var p0=pFS(s0,i);var p1=pFS(s1,i);\n" +
            "[linear(f,0,1,p0[0],p1[0]),linear(f,0,1,p0[1],p1[1])];";
    }

    function scaleExpr(i) {
        return hdr(i) + geom() +
            "function sFS(st,n){\n" +
            "  if(st==0){seedRandom(n+555,true);return(random()<keepR)?baseS*1.0:0;}\n" +
            "  if(st==1){seedRandom(n+99,true);return baseS*random(0.30,0.50);}\n" +
            "  if(st==2){return baseS;}\n" +
            "  if(st==3){\n" +
            "    var big=false;var a=angIdx(n);\n" +
            "    if(ringOf(n)==R&&a>=0){\n" +
            "      var step=A/symN;var off=(t*symSpd)%step;\n" +
            "      var d=((a-off)%step+step)%step;\n" +
            "      if(d<0.5||d>step-0.5)big=true;\n" +
            "    }\n" +
            "    if(Math.sin(t*0.9+n*0.55)>0.9)big=true;\n" +
            "    return big?baseS*2.8:baseS*0.45;\n" +
            "  }\n" +
            "  if(st==4){\n" +
            "    var sel=3+Math.round((1+Math.sin(t*0.35))*2);\n" +
            "    return(ringOf(n)==sel)?baseS*2.8:baseS*0.45;\n" +
            "  }\n" +
            "  seedRandom(n,true);var ofs=random(0,100);\n" +
            "  var nz=(Math.sin(t*1.5+ofs)+Math.sin(t*0.6+ofs*1.3))*0.5;\n" +
            "  return baseS*(1.0+nz*0.85);\n" +
            "}\n" +
            "var s0=Math.floor(s);var s1=Math.min(s0+1,MS);var f=ease(s-s0,0,1);\n" +
            "var v=linear(f,0,1,sFS(s0,i),sFS(s1,i));[v,v];";
    }

    function colorExpr(i) {
        var ps = "[";
        for (var p = 0; p < CONFIG.palette.length; p++) {
            var c = CONFIG.palette[p];
            ps += "[" + c[0] + "," + c[1] + "," + c[2] + "," + c[3] + "]";
            if (p < CONFIG.palette.length - 1) ps += ",";
        }
        ps += "]";
        return hdr(i) +
            "var black=[0,0,0,1];var pal=" + ps + ";\n" +
            "function cFS(st,n){\n" +
            "  if(st<5)return black;\n" +
            "  seedRandom(n+7,true);return pal[Math.floor(random(0,pal.length))];\n" +
            "}\n" +
            "var s0=Math.floor(s);var s1=Math.min(s0+1,MS);var f=ease(s-s0,0,1);\n" +
            "var c0=cFS(s0,i);var c1=cFS(s1,i);\n" +
            "[linear(f,0,1,c0[0],c1[0]),linear(f,0,1,c0[1],c1[1]),linear(f,0,1,c0[2],c1[2]),1];";
    }

    // =================================================================
    // 既存コンプを探して削除（重複防止）
    // =================================================================
    function removeExistingComp(proj, name) {
        for (var idx = proj.items.length; idx >= 1; idx--) {
            var item = proj.items[idx];
            if (item instanceof CompItem && item.name === name) {
                item.remove();
            }
        }
    }

    // =================================================================
    // 生成本体
    // =================================================================
    function build() {
        var proj = app.project;
        if (!proj) { alert("プロジェクトが開いていません。"); return; }

        // 同名コンプが既にある場合は確認
        var hasExisting = false;
        for (var ci = 1; ci <= proj.items.length; ci++) {
            var it = proj.items[ci];
            if (it instanceof CompItem && it.name === CONFIG.compName) {
                hasExisting = true;
                break;
            }
        }
        if (hasExisting) {
            var ok = confirm(
                "「" + CONFIG.compName + "」が既に存在します。\n" +
                "削除して新たに生成しますか？"
            );
            if (!ok) return;
            removeExistingComp(proj, CONFIG.compName);
        }

        var comp = proj.items.addComp(
            CONFIG.compName, CONFIG.compW, CONFIG.compH,
            1, CONFIG.duration, CONFIG.fps
        );
        comp.openInViewer();

        // 背景
        var bg = comp.layers.addSolid(CONFIG.bgColor, "BG", CONFIG.compW, CONFIG.compH, 1);
        bg.locked = true;

        // コントローラー（名前を WAVE_CTRL に変更）
        var ctrl = comp.layers.addNull();
        ctrl.name = "WAVE_CTRL";
        ctrl.label = 9;
        var slider = ctrl.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
        slider.name = "State";
        var stateProp = slider.property("ADBE Slider Control-0001");

        for (var k = 0; k < CONFIG.stateKeys.length; k++) {
            stateProp.setValueAtTime(CONFIG.stateKeys[k][0], CONFIG.stateKeys[k][1]);
        }
        var eIn  = new KeyframeEase(0, 50);
        var eOut = new KeyframeEase(0, 50);
        for (var ki = 1; ki <= stateProp.numKeys; ki++) {
            try {
                stateProp.setInterpolationTypeAtKey(ki,
                    KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
                stateProp.setTemporalEaseAtKey(ki, [eIn], [eOut]);
            } catch (e) {}
        }

        // ドット生成
        var total = CONFIG.rings * CONFIG.angular + (CONFIG.addCenter ? 1 : 0);
        for (var i = 0; i < total; i++) {
            var lyr     = comp.layers.addShape();
            lyr.name    = "dot_" + zeroPad(i, 4);

            var root    = lyr.property("ADBE Root Vectors Group");
            var grp     = root.addProperty("ADBE Vector Group");
            var gc      = grp.property("ADBE Vectors Group");

            var ell = gc.addProperty("ADBE Vector Shape - Ellipse");
            ell.property("ADBE Vector Ellipse Size").setValue([CONFIG.dotSize, CONFIG.dotSize]);

            var fill  = gc.addProperty("ADBE Vector Graphic - Fill");
            var fillC = fill.property("ADBE Vector Fill Color");
            fillC.setValue([0, 0, 0, 1]);

            var tr = lyr.property("ADBE Transform Group");
            tr.property("ADBE Position").expression = posExpr(i);
            tr.property("ADBE Scale").expression    = scaleExpr(i);
            fillC.expression                        = colorExpr(i);
        }

        ctrl.moveToBeginning();
        alert("DesignWave を生成しました！\nRAM プレビューで確認してください。");
    }

    function zeroPad(n, w) {
        var s = String(n);
        while (s.length < w) s = "0" + s;
        return s;
    }

    // =================================================================
    // 実行
    // =================================================================
    function run() {
        if (!app) { alert("After Effects で実行してください。"); return; }
        app.beginUndoGroup("Generate DesignWave");
        try { build(); }
        catch (err) {
            alert("エラー:\n" + err.toString() + "\n(line " + (err.line || "?") + ")");
        } finally {
            app.endUndoGroup();
        }
    }

    if (thisObj instanceof Panel ||
        (thisObj && thisObj.toString && thisObj.toString() === "[object Panel]")) {
        var btn = thisObj.add("button", undefined, "Generate DesignWave");
        btn.onClick = run;
        thisObj.layout.layout(true);
    } else {
        run();
    }

})(this);
