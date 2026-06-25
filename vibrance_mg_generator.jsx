// =============================================================
// Vibrance MG Generator  v1.0
// After Effects ExtendScript (.jsx)
//
// 解析元: Vibrance motion graphics (MP4 + MOV)
// 各セグメントをコンポジション上に自動生成します。
//
// 使い方:
//   AE メニュー > ファイル > スクリプト > スクリプトファイルを実行
//   または ScriptUI パネルとして配置
// =============================================================

(function vibranceMG(thisObj) {

    // ─────────────────────────────────────────────
    // 基本設定
    // ─────────────────────────────────────────────
    var CFG = {
        w:   1280,
        h:   720,
        fps: 24,
        dur: 30,
        bg:  [0.831, 0.812, 0.784]  // #D4CFCA ベージュ
    };

    // カラーパレット  [R, G, B, A]  0-1
    var C = {
        pink:    [0.96, 0.44, 0.53, 1],
        coral:   [0.96, 0.58, 0.45, 1],
        orange:  [0.96, 0.72, 0.35, 1],
        peach:   [0.98, 0.82, 0.72, 1],
        green:   [0.55, 0.85, 0.50, 1],
        lgreen:  [0.70, 0.93, 0.55, 1],
        teal:    [0.35, 0.85, 0.75, 1],
        blue:    [0.35, 0.55, 0.95, 1],
        lblue:   [0.55, 0.78, 0.98, 1],
        purple:  [0.60, 0.40, 0.90, 1],
        violet:  [0.75, 0.45, 0.95, 1],
        lavend:  [0.78, 0.68, 0.98, 1],
        dark:    [0.22, 0.20, 0.18, 1],
        white:   [1.00, 1.00, 1.00, 1],
    };

    // ─────────────────────────────────────────────
    // イージングユーティリティ
    // ─────────────────────────────────────────────
    function eo(speed) { return new KeyframeEase(0, speed || 80); }
    function ei(speed) { return new KeyframeEase(0, speed || 20); }
    function em()      { return new KeyframeEase(0, 50); }

    function applyEase(prop, keyIdx, inE, outE) {
        try {
            prop.setTemporalEaseAtKey(keyIdx, [inE || em()], [outE || em()]);
        } catch(e) {}
    }

    // キーフレームを2点セットして出力イーズを適用
    function kf2(prop, t0, v0, t1, v1, easeMode) {
        prop.setValueAtTime(t0, v0);
        prop.setValueAtTime(t1, v1);
        if (easeMode === "out") {
            applyEase(prop, 1, ei(), eo());
            applyEase(prop, 2, eo(), eo());
        } else if (easeMode === "in") {
            applyEase(prop, 1, em(), em());
        }
    }

    // ─────────────────────────────────────────────
    // レイヤー生成ユーティリティ
    // ─────────────────────────────────────────────
    function addShape(comp, name, inPt, outPt) {
        var l = comp.layers.addShape();
        l.name = name || "Shape";
        if (inPt  !== undefined) l.inPoint  = inPt;
        if (outPt !== undefined) l.outPoint = outPt;
        return l;
    }

    function addSolid(comp, col, name, w, h, inPt, outPt) {
        var l = comp.layers.addSolid(col, name || "Solid", w || CFG.w, h || CFG.h, 1);
        if (inPt  !== undefined) l.inPoint  = inPt;
        if (outPt !== undefined) l.outPoint = outPt;
        return l;
    }

    // Shape: 矩形グループを ADBE Root Vectors Group に追加
    function addRectGroup(layer, w, h, fillCol, strokeCol, strokeW, roundness) {
        var root = layer.property("ADBE Root Vectors Group");
        var grp  = root.addProperty("ADBE Vector Group");
        var vg   = grp.property("ADBE Vectors Group");

        var r = vg.addProperty("ADBE Vector Shape - Rect");
        r.property("ADBE Vector Rect Size").setValue([w, h]);
        if (roundness) r.property("ADBE Vector Rect Roundness").setValue(roundness);

        if (fillCol) {
            var f = vg.addProperty("ADBE Vector Graphic - Fill");
            f.property("ADBE Vector Fill Color").setValue(fillCol);
        }
        if (strokeCol) {
            var s = vg.addProperty("ADBE Vector Graphic - Stroke");
            s.property("ADBE Vector Stroke Color").setValue(strokeCol);
            s.property("ADBE Vector Stroke Width").setValue(strokeW || 2);
            s.property("ADBE Vector Stroke Line Cap").setValue(2); // round
        }
        return grp;
    }

    // Shape: 楕円グループを追加
    function addEllipseGroup(layer, w, h, posX, posY, fillCol, strokeCol, strokeW) {
        var root = layer.property("ADBE Root Vectors Group");
        var grp  = root.addProperty("ADBE Vector Group");
        var vg   = grp.property("ADBE Vectors Group");

        var e = vg.addProperty("ADBE Vector Shape - Ellipse");
        e.property("ADBE Vector Ellipse Size").setValue([w, h]);
        if (posX !== undefined) e.property("ADBE Vector Ellipse Position").setValue([posX, posY || 0]);

        if (fillCol) {
            var f = vg.addProperty("ADBE Vector Graphic - Fill");
            f.property("ADBE Vector Fill Color").setValue(fillCol);
        }
        if (strokeCol) {
            var s = vg.addProperty("ADBE Vector Graphic - Stroke");
            s.property("ADBE Vector Stroke Color").setValue(strokeCol);
            s.property("ADBE Vector Stroke Width").setValue(strokeW || 2);
        }
        return grp;
    }

    // エフェクト追加ラッパー
    function addFX(layer, matchName) {
        try {
            return layer.property("Effects").addProperty(matchName);
        } catch(e) {
            return null;
        }
    }

    // グラデーションランプをソリッドに適用
    function applyGradRamp(layer, sx, sy, sc, ex, ey, ec, shape) {
        var fx = addFX(layer, "ADBE Ramp");
        if (!fx) return;
        fx.property("ADBE Ramp-0001").setValue([sx, sy]);
        fx.property("ADBE Ramp-0002").setValue(sc.slice(0, 3));
        fx.property("ADBE Ramp-0003").setValue([ex, ey]);
        fx.property("ADBE Ramp-0004").setValue(ec.slice(0, 3));
        fx.property("ADBE Ramp-0005").setValue(shape || 1); // 1=linear 2=radial
        return fx;
    }

    // CC Sphere をソリッドに適用
    function applyCCSphere(layer, radius, ambientPct) {
        var fx = addFX(layer, "CC Sphere");
        if (!fx) return null;
        try { fx.property("Radius").setValue(radius || 100); } catch(e) {}
        try { fx.property("Shading").property("Ambient").setValue(ambientPct || 30); } catch(e) {}
        return fx;
    }

    // CC Cylinder をソリッドに適用 (リボン曲げに使用)
    function applyCCCylinder(layer, radius) {
        var fx = addFX(layer, "CC Cylinder");
        if (!fx) return null;
        try { fx.property("Radius").setValue(radius || 200); } catch(e) {}
        return fx;
    }

    // ─────────────────────────────────────────────
    // セグメント 1: アーク弧線  (t=1.0〜3.0s)
    // 細いピンクの曲線がトリムパスで右へ描かれる
    // ─────────────────────────────────────────────
    function seg01_arcLine(comp, t0) {
        var l = addShape(comp, "S01_ArcLine", t0, t0 + 2.2);
        l.property("Position").setValue([CFG.w / 2, CFG.h / 2 + 5]);

        var root = l.property("ADBE Root Vectors Group");
        var grp  = root.addProperty("ADBE Vector Group");
        var vg   = grp.property("ADBE Vectors Group");

        // 手書き風ベジェ弧
        var sp  = vg.addProperty("ADBE Vector Shape - Group");
        var sh  = new Shape();
        sh.vertices    = [[-210, 5], [-70, -15], [70, -15], [210, 5]];
        sh.inTangents  = [[0, 0], [-55, -18], [-55,  18], [0, 0]];
        sh.outTangents = [[55, -18], [55,  18], [-55, -18], [0, 0]];
        sh.closed = false;
        sp.property("ADBE Vector Shape").setValue(sh);

        var stroke = vg.addProperty("ADBE Vector Graphic - Stroke");
        stroke.property("ADBE Vector Stroke Color").setValue(C.pink);
        stroke.property("ADBE Vector Stroke Width").setValue(3.5);
        stroke.property("ADBE Vector Stroke Line Cap").setValue(2);

        // Trim Paths アニメーション
        var trim = root.addProperty("ADBE Vector Filter - Trim");
        var endP = trim.property("ADBE Vector Trim End");
        kf2(endP, t0, 0, t0 + 1.2, 100, "out");

        // フェードアウト
        kf2(l.property("Opacity"), t0 + 1.8, 100, t0 + 2.2, 0);
    }

    // ─────────────────────────────────────────────
    // セグメント 2: 縦バー群  (t=2.8〜5.2s)
    // 細い縦矩形が下からスケールアップして出現
    // ─────────────────────────────────────────────
    function seg02_verticalBars(comp, t0) {
        var palette = [C.dark, C.dark, C.blue, C.pink, C.dark, C.violet, C.dark, C.dark];
        var barW = 3, barH = 195, gap = 23;
        var n = palette.length;
        var totalW = (n - 1) * gap;

        for (var i = 0; i < n; i++) {
            var l = addShape(comp, "S02_Bar" + i, t0, t0 + 2.4);
            var x = CFG.w / 2 - totalW / 2 + i * gap;
            l.property("Position").setValue([x, CFG.h / 2]);

            addRectGroup(l, barW, barH, palette[i], null, 0, 1.5);

            // Y スケール 0→100 (スタガー)
            var sc = l.property("Scale");
            var delay = i * 0.045;
            kf2(sc, t0 + delay,       [100, 0],   t0 + 0.55 + delay, [100, 100], "out");

            // フェードアウト
            kf2(l.property("Opacity"), t0 + 2.0, 100, t0 + 2.4, 0);
        }
    }

    // ─────────────────────────────────────────────
    // セグメント 3: グラデーションブロック  (t=4.8〜7.2s)
    // 幅広の矩形ブロックが左右から展開
    // ─────────────────────────────────────────────
    function seg03_gradBlocks(comp, t0) {
        var blocks = [
            { x: CFG.w / 2 - 95, sc: C.purple, ec: C.blue,   scaleDir: [-1, 0] },
            { x: CFG.w / 2 + 95, sc: C.pink,   ec: C.purple, scaleDir: [1, 0]  },
        ];

        for (var b = 0; b < blocks.length; b++) {
            var blk = blocks[b];
            var l = addSolid(comp, [1, 1, 1], "S03_Block" + b, 140, 185, t0, t0 + 2.4);
            l.property("Position").setValue([blk.x, CFG.h / 2]);

            applyGradRamp(l,
                0,    0,   blk.sc,
                140, 185,  blk.ec,
                1
            );

            // X スケール展開
            kf2(l.property("Scale"), t0 + b * 0.1, [0, 100], t0 + 0.6 + b * 0.1, [100, 100], "out");
            kf2(l.property("Opacity"), t0 + 1.9, 100, t0 + 2.4, 0);
        }

        // 中央の細い仕切り線
        var div = addShape(comp, "S03_Divider", t0 + 0.3, t0 + 2.1);
        div.property("Position").setValue([CFG.w / 2, CFG.h / 2]);
        addRectGroup(div, 2, 185, C.lavend);
        kf2(div.property("Opacity"), t0 + 1.8, 100, t0 + 2.1, 0);
    }

    // ─────────────────────────────────────────────
    // セグメント 4: 3D 折りたたみパネル  (t=7.0〜9.4s)
    // Y軸回転する半透明グラデパネル群
    // ─────────────────────────────────────────────
    function seg04_foldedPanels(comp, t0) {
        var panels = [
            { x: CFG.w/2 - 80, y: CFG.h/2, sc: C.orange, ec: C.peach,  rotY:  35, delay: 0     },
            { x: CFG.w/2,      y: CFG.h/2, sc: C.green,  ec: C.lgreen, rotY: -20, delay: 0.1   },
            { x: CFG.w/2 + 80, y: CFG.h/2, sc: C.pink,   ec: C.coral,  rotY:  25, delay: 0.2   },
        ];

        for (var p = 0; p < panels.length; p++) {
            var pn = panels[p];
            var l = addSolid(comp, [1, 1, 1], "S04_Panel" + p, 110, 160, t0, t0 + 2.4);
            l.threeDLayer = true;
            l.property("Position").setValue([pn.x, pn.y, 0]);

            applyGradRamp(l, 0, 0, pn.sc, 110, 160, pn.ec, 1);

            // Y 軸回転アニメーション
            var ry = l.property("Rotation Y");
            kf2(ry, t0 + pn.delay,       pn.rotY + 60,
                    t0 + pn.delay + 0.7,  pn.rotY, "out");
            kf2(ry, t0 + 1.8, pn.rotY, t0 + 2.4, pn.rotY + 40);

            l.property("Opacity").setValue(82);

            // フェードアウト
            kf2(l.property("Opacity"), t0 + 2.0, 82, t0 + 2.4, 0);
        }
    }

    // ─────────────────────────────────────────────
    // セグメント 5: 球体クラスター  (t=9.2〜11.6s)
    // メタボール的な重なり球体(2組)
    // ─────────────────────────────────────────────
    function seg05_sphereCluster(comp, t0) {
        var groups = [
            { cx: CFG.w/2 - 105, spheres: [
                { dx: -45, r: 58, c1: C.purple, c2: C.violet },
                { dx:   0, r: 68, c1: C.blue,   c2: C.purple },
                { dx:  45, r: 52, c1: C.violet, c2: C.pink   },
            ]},
            { cx: CFG.w/2 + 105, spheres: [
                { dx: -45, r: 52, c1: C.pink,   c2: C.violet },
                { dx:   0, r: 68, c1: C.purple, c2: C.blue   },
                { dx:  45, r: 58, c1: C.violet, c2: C.purple },
            ]},
        ];

        for (var g = 0; g < groups.length; g++) {
            var grp = groups[g];
            for (var s = 0; s < grp.spheres.length; s++) {
                var sp = grp.spheres[s];
                var sz = sp.r * 2;
                var l = addSolid(comp, [1, 1, 1], "S05_Sph" + g + "_" + s, sz, sz, t0, t0 + 2.4);
                l.property("Position").setValue([grp.cx + sp.dx, CFG.h / 2]);

                applyGradRamp(l, sz*0.3, sz*0.2, sp.c1, sz*0.8, sz*0.8, sp.c2, 2);
                applyCCSphere(l, sp.r, 25);

                l.blendingMode = BlendingMode.ADD;

                var sc = l.property("Scale");
                kf2(sc, t0 + s * 0.06, [0, 0], t0 + 0.55 + s * 0.06, [100, 100], "out");
                kf2(l.property("Opacity"), t0 + 2.0, 80, t0 + 2.4, 0);
            }
        }
    }

    // ─────────────────────────────────────────────
    // セグメント 6: コイン / ディスク  (t=11.4〜14.0s)
    // 暗い3Dコイン型楕円が散布 & X軸回転
    // ─────────────────────────────────────────────
    function seg06_coins(comp, t0) {
        var coins = [
            { x: CFG.w/2 - 185, y: CFG.h/2 - 75,  r:  48, phase: 0.0 },
            { x: CFG.w/2 + 155, y: CFG.h/2 - 65,  r:  45, phase: 0.3 },
            { x: CFG.w/2 - 65,  y: CFG.h/2 - 100, r:  40, phase: 0.7 },
            { x: CFG.w/2 + 55,  y: CFG.h/2 + 95,  r:  52, phase: 1.1 },
            { x: CFG.w/2 - 140, y: CFG.h/2 + 100, r:  44, phase: 0.5 },
            { x: CFG.w/2 + 210, y: CFG.h/2 + 40,  r:  38, phase: 0.9 },
            { x: CFG.w/2 + 5,   y: CFG.h/2 - 15,  r:  55, phase: 0.2 },
        ];

        for (var i = 0; i < coins.length; i++) {
            var coin = coins[i];
            var l = addShape(comp, "S06_Coin" + i, t0, t0 + 2.6);
            l.property("Position").setValue([coin.x, coin.y]);

            addEllipseGroup(l, coin.r * 2, coin.r * 2, 0, 0, C.dark);

            // 初期スケールはランダム傾きを模倣 (scaleX で奥行き表現)
            var tilt = [15 + Math.floor(Math.random() * 70), 100];
            l.property("Scale").setValue(tilt);

            // コインフリップ: scaleX 100→10→100 のサイクル
            var sc = l.property("Scale");
            var ph = coin.phase;
            sc.setValueAtTime(t0 + ph,       [tilt[0], 100]);
            sc.setValueAtTime(t0 + ph + 0.3, [8,       100]);
            sc.setValueAtTime(t0 + ph + 0.6, [tilt[0], 100]);
            sc.setValueAtTime(t0 + ph + 0.9, [8,       100]);
            sc.setValueAtTime(t0 + ph + 1.2, [tilt[0], 100]);

            kf2(l.property("Opacity"), t0 + 2.2, 100, t0 + 2.6, 0);
        }
    }

    // ─────────────────────────────────────────────
    // セグメント 7: アウトラインサークル + カプセル  (t=13.8〜16.0s)
    // ストローク円をトリムパスで描画 + 外枠カプセル
    // ─────────────────────────────────────────────
    function seg07_outlineCircles(comp, t0) {
        var n  = 6;
        var r  = 30;
        var overlap = 12;
        var step = r * 2 - overlap;
        var totalW = step * (n - 1) + r * 2;
        var startX = CFG.w / 2 - totalW / 2 + r;

        for (var i = 0; i < n; i++) {
            var l = addShape(comp, "S07_Circle" + i, t0, t0 + 2.2);
            l.property("Position").setValue([startX + i * step, CFG.h / 2]);

            addEllipseGroup(l, r * 2, r * 2, 0, 0, null, [0.38, 0.35, 0.30, 1], 1.5);

            // Trim Paths
            var root = l.property("ADBE Root Vectors Group");
            var trim = root.addProperty("ADBE Vector Filter - Trim");
            var endP = trim.property("ADBE Vector Trim End");
            kf2(endP, t0 + i * 0.07, 0, t0 + 0.5 + i * 0.07, 100, "out");

            kf2(l.property("Opacity"), t0 + 1.8, 100, t0 + 2.2, 0);
        }

        // 外枠カプセル
        var cap = addShape(comp, "S07_Capsule", t0 + 0.2, t0 + 2.2);
        cap.property("Position").setValue([CFG.w / 2, CFG.h / 2]);
        var root = cap.property("ADBE Root Vectors Group");
        var grp  = root.addProperty("ADBE Vector Group");
        var vg   = grp.property("ADBE Vectors Group");
        var rect = vg.addProperty("ADBE Vector Shape - Rect");
        rect.property("ADBE Vector Rect Size").setValue([totalW + 20, r * 2 + 20]);
        rect.property("ADBE Vector Rect Roundness").setValue(r + 10);
        var s = vg.addProperty("ADBE Vector Graphic - Stroke");
        s.property("ADBE Vector Stroke Color").setValue([0.38, 0.35, 0.30, 1]);
        s.property("ADBE Vector Stroke Width").setValue(1.5);

        var trimC = root.addProperty("ADBE Vector Filter - Trim");
        var endC  = trimC.property("ADBE Vector Trim End");
        kf2(endC, t0 + 0.2, 0, t0 + 0.9, 100, "out");
        kf2(cap.property("Opacity"), t0 + 1.8, 100, t0 + 2.2, 0);
    }

    // ─────────────────────────────────────────────
    // セグメント 8: 曲がりリボン  (t=15.8〜18.2s)
    // CC Cylinder でグラデソリッドを曲げた弧リボン
    // ─────────────────────────────────────────────
    function seg08_bentRibbon(comp, t0) {
        var l = addSolid(comp, [1, 1, 1], "S08_Ribbon", 340, 45, t0, t0 + 2.4);
        l.property("Position").setValue([CFG.w / 2 - 20, CFG.h / 2 - 25]);

        applyGradRamp(l, 0, 22, C.green, 340, 22, C.coral, 1);
        applyCCCylinder(l, 250);

        var sc = l.property("Scale");
        kf2(sc, t0, [0, 0], t0 + 0.7, [100, 100], "out");

        var rot = l.property("Rotation");
        kf2(rot, t0, -12, t0 + 2.4, 6);

        kf2(l.property("Opacity"), t0 + 2.0, 100, t0 + 2.4, 0);
    }

    // ─────────────────────────────────────────────
    // セグメント 9: 花びら + 白球  (t=17.8〜21.0s)
    // Shape Repeater で花びらを回転、中心に白球
    // ─────────────────────────────────────────────
    function seg09_flowerPetals(comp, t0, bgCol, petalCol, numPetals) {
        bgCol     = bgCol    || [0.97, 0.72, 0.67];
        petalCol  = petalCol || C.peach;
        numPetals = numPetals || 16;

        // 背景
        var bg = addSolid(comp, [1, 1, 1], "S09_FlowerBG", CFG.w, CFG.h, t0, t0 + 3.2);
        applyGradRamp(bg,
            CFG.w / 2, CFG.h / 2, bgCol.concat([1]),
            CFG.w * 0.85, CFG.h * 0.85, [bgCol[0] * 0.7, bgCol[1] * 0.55, bgCol[2] * 0.55, 1],
            2
        );
        kf2(bg.property("Opacity"), t0, 0, t0 + 0.6, 100);
        kf2(bg.property("Opacity"), t0 + 2.8, 100, t0 + 3.2, 0);

        // 花びら
        var petal = addShape(comp, "S09_Petals", t0, t0 + 3.2);
        petal.property("Position").setValue([CFG.w / 2, CFG.h / 2]);

        var root = petal.property("ADBE Root Vectors Group");
        var grp  = root.addProperty("ADBE Vector Group");
        var vg   = grp.property("ADBE Vectors Group");

        // 1枚の花びら楕円 (中心から上にオフセット)
        var e = vg.addProperty("ADBE Vector Shape - Ellipse");
        e.property("ADBE Vector Ellipse Size").setValue([30, 72]);
        e.property("ADBE Vector Ellipse Position").setValue([0, -62]);

        var f = vg.addProperty("ADBE Vector Graphic - Fill");
        f.property("ADBE Vector Fill Color").setValue(petalCol);

        // Repeater で円形配置
        var rep = root.addProperty("ADBE Vector Filter - Repeater");
        rep.property("ADBE Vector Repeater Copies").setValue(numPetals);
        rep.property("ADBE Vector Repeater Offset").setValue(0);
        var xf = rep.property("ADBE Vector Repeater Transform");
        xf.property("ADBE Vector Repeater Rotation").setValue(360 / numPetals);
        xf.property("ADBE Vector Repeater Anchor Point").setValue([0, 0]);
        xf.property("ADBE Vector Repeater Position").setValue([0, 0]);

        // 出現 & 回転
        kf2(petal.property("Scale"), t0, [0, 0], t0 + 0.85, [100, 100], "out");
        kf2(petal.property("Rotation"), t0, 0, t0 + 3.2, 100);
        kf2(petal.property("Opacity"), t0 + 2.8, 100, t0 + 3.2, 0);

        // 白い中心球
        var center = addShape(comp, "S09_Center", t0 + 0.3, t0 + 3.2);
        center.property("Position").setValue([CFG.w / 2, CFG.h / 2]);
        addEllipseGroup(center, 44, 44, 0, 0, C.white);
        kf2(center.property("Scale"), t0 + 0.3, [0, 0], t0 + 0.8, [100, 100], "out");
        kf2(center.property("Opacity"), t0 + 2.8, 100, t0 + 3.2, 0);
    }

    // ─────────────────────────────────────────────
    // セグメント 10: 軌道楕円 + 中央花  (t=21.0〜24.2s)
    // 紫背景、周囲を大きいベージュ楕円が公転
    // ─────────────────────────────────────────────
    function seg10_orbitalFlower(comp, t0) {
        // 紫背景
        var bg = addSolid(comp, [1, 1, 1], "S10_PurpleBG", CFG.w, CFG.h, t0, t0 + 3.2);
        applyGradRamp(bg,
            CFG.w / 2, CFG.h / 2,  [0.82, 0.72, 0.98, 1],
            CFG.w, CFG.h,           [0.58, 0.42, 0.90, 1],
            2
        );
        kf2(bg.property("Opacity"), t0, 0, t0 + 0.5, 100);
        kf2(bg.property("Opacity"), t0 + 2.8, 100, t0 + 3.2, 0);

        // 公転楕円 (4個)
        var orbs = [
            { angle:   0, dist: 230 },
            { angle:  90, dist: 230 },
            { angle: 180, dist: 230 },
            { angle: 270, dist: 230 },
        ];

        for (var o = 0; o < orbs.length; o++) {
            var orb = orbs[o];
            var l = addShape(comp, "S10_Orb" + o, t0, t0 + 3.2);

            var startAngle = orb.angle * (Math.PI / 180);
            var bx = CFG.w / 2 + Math.cos(startAngle) * orb.dist;
            var by = CFG.h / 2 + Math.sin(startAngle) * orb.dist * 0.55;
            l.property("Position").setValue([bx, by]);

            addEllipseGroup(l, 115, 75, 0, 0, C.peach);
            kf2(l.property("Opacity"), t0, 0, t0 + 0.5, 90);
            kf2(l.property("Opacity"), t0 + 2.8, 90, t0 + 3.2, 0);

            // 公転: Position を円軌跡でアニメーション
            var posP = l.property("Position");
            var steps = 8;
            for (var st = 0; st <= steps; st++) {
                var frac = st / steps;
                var ang  = startAngle + frac * Math.PI * 2;
                var px   = CFG.w / 2 + Math.cos(ang) * orb.dist;
                var py   = CFG.h / 2 + Math.sin(ang) * orb.dist * 0.55;
                posP.setValueAtTime(t0 + frac * 3.2, [px, py]);
            }
        }

        // 中央の花 (小さめ)
        seg09_flowerPetals(comp, t0, [0.95, 0.55, 0.78], C.pink, 12);
        // ※ seg09 内の bg と重なるので Opacity で制御済み
    }

    // ─────────────────────────────────────────────
    // セグメント 11: グリーングローブ  (t=24.0〜27.0s)
    // 緑全面背景 + CC Sphere 大球 + 内部ディスク光
    // ─────────────────────────────────────────────
    function seg11_globe(comp, t0) {
        // 緑ラジアル背景
        var bg = addSolid(comp, [1, 1, 1], "S11_GreenBG", CFG.w, CFG.h, t0, t0 + 3);
        applyGradRamp(bg,
            CFG.w * 0.3, CFG.h * 0.3, [0.72, 0.92, 0.45, 1],
            CFG.w * 0.75, CFG.h * 0.75, [0.38, 0.72, 0.22, 1],
            2
        );
        kf2(bg.property("Opacity"), t0, 0, t0 + 0.7, 100);
        kf2(bg.property("Opacity"), t0 + 2.6, 100, t0 + 3, 0);

        // 大球 (CC Sphere)
        var globe = addSolid(comp, [1, 1, 1], "S11_Globe", CFG.w, CFG.h, t0, t0 + 3);
        applyGradRamp(globe,
            CFG.w * 0.35, CFG.h * 0.35, [0.58, 0.88, 0.40, 1],
            CFG.w * 0.70, CFG.h * 0.72, [0.96, 0.52, 0.35, 1],
            2
        );
        applyCCSphere(globe, 270, 20);
        globe.property("Position").setValue([CFG.w / 2, CFG.h / 2]);

        kf2(globe.property("Scale"), t0, [0, 0], t0 + 0.9, [100, 100], "out");
        kf2(globe.property("Opacity"), t0 + 2.6, 100, t0 + 3, 0);

        // 内部光ディスク (Screen ブレンド)
        var disc = addSolid(comp, [1, 1, 1], "S11_Disc", 420, 80, t0 + 0.3, t0 + 3);
        disc.property("Position").setValue([CFG.w / 2, CFG.h / 2 + 15]);

        applyGradRamp(disc, 0, 40, [1.0, 0.85, 0.85, 1], 420, 40, [0.98, 0.68, 0.72, 1], 1);

        disc.blendingMode = BlendingMode.SCREEN;
        kf2(disc.property("Scale"), t0 + 0.3, [80, 6], t0 + 0.9, [80, 14], "out");
        kf2(disc.property("Rotation"), t0 + 0.3, -30, t0 + 3, 30);
        kf2(disc.property("Opacity"), t0 + 2.6, 100, t0 + 3, 0);
    }

    // ─────────────────────────────────────────────
    // セグメント 12: フルブリード トーラス  (t=26.8〜30s)
    // 両サイドから大型トーラスが張り出す (CC Sphere 多重)
    // ─────────────────────────────────────────────
    function seg12_torusFullBleed(comp, t0, col1, col2, col3) {
        col1 = col1 || C.orange;
        col2 = col2 || C.pink;
        col3 = col3 || C.green;

        var sides = [
            { cx: CFG.w * 0.08, c1: col1, c2: col2 },
            { cx: CFG.w * 0.92, c1: col3, c2: col2 },
        ];

        for (var s = 0; s < sides.length; s++) {
            var side = sides[s];
            // 3リング重ねでトーラス感を演出
            for (var ring = 0; ring < 3; ring++) {
                var radius = 210 + ring * 65;
                var l = addSolid(comp, [1, 1, 1], "S12_Torus_" + s + "_" + ring, 700, 700, t0, t0 + 3.2);
                l.property("Position").setValue([side.cx, CFG.h / 2]);

                applyGradRamp(l,
                    350, 350, side.c1,
                    700, 700, side.c2,
                    2
                );
                applyCCSphere(l, radius, 20 + ring * 8);

                if (ring > 0) {
                    l.blendingMode = BlendingMode.SCREEN;
                    l.property("Opacity").setValue(55 - ring * 8);
                }

                kf2(l.property("Scale"), t0, [0, 0], t0 + 0.8 + ring * 0.12, [100, 100], "out");
                kf2(l.property("Opacity"), t0 + 2.8, ring === 0 ? 100 : 55 - ring * 8, t0 + 3.2, 0);
            }
        }

        // 中央の縦グラデバー (縦スペクトル感)
        var bars = [
            { x: -55, col: col3 }, { x: -30, col: col1 },
            { x:  -5, col: col2 }, { x:  20, col: col3 },
            { x:  45, col: col1 },
        ];
        for (var b = 0; b < bars.length; b++) {
            var bar = bars[b];
            var bl = addShape(comp, "S12_CenterBar" + b, t0 + 0.4, t0 + 3.2);
            bl.property("Position").setValue([CFG.w / 2 + bar.x, CFG.h / 2]);
            addRectGroup(bl, 4, CFG.h * 0.7, bar.col);
            var sc = bl.property("Scale");
            kf2(sc, t0 + 0.4 + b * 0.04, [100, 0], t0 + 0.9 + b * 0.04, [100, 100], "out");
            kf2(bl.property("Opacity"), t0 + 2.8, 70, t0 + 3.2, 0);
        }
    }

    // ─────────────────────────────────────────────
    // メイン: 全セグメントをコンポジションに配置
    // ─────────────────────────────────────────────
    function buildAll() {
        app.beginUndoGroup("Vibrance MG: Generate All");

        var comp = app.project.items.addComp("Vibrance_MG", CFG.w, CFG.h, 1, CFG.dur, CFG.fps);

        // 背景 (常時表示)
        addSolid(comp, CFG.bg, "BG", CFG.w, CFG.h);

        // セグメント配置
        seg01_arcLine(comp,          1.0);   //  1.0 〜  3.2
        seg02_verticalBars(comp,     3.0);   //  3.0 〜  5.4
        seg03_gradBlocks(comp,       5.2);   //  5.2 〜  7.6
        seg04_foldedPanels(comp,     7.4);   //  7.4 〜  9.8
        seg05_sphereCluster(comp,    9.6);   //  9.6 〜 12.0
        seg06_coins(comp,           11.8);   // 11.8 〜 14.4
        seg07_outlineCircles(comp,  14.2);   // 14.2 〜 16.4
        seg08_bentRibbon(comp,      16.2);   // 16.2 〜 18.6
        seg09_flowerPetals(comp,    18.4);   // 18.4 〜 21.6
        seg10_orbitalFlower(comp,   21.4);   // 21.4 〜 24.6
        seg11_globe(comp,           24.4);   // 24.4 〜 27.4
        seg12_torusFullBleed(comp,  27.2);   // 27.2 〜 30.0

        comp.openInViewer();
        app.endUndoGroup();
        alert("Vibrance MG 生成完了!\nコンポジション: " + comp.name);
    }

    // ─────────────────────────────────────────────
    // 個別セグメントのみ生成
    // ─────────────────────────────────────────────
    function buildSingle(segFn, segName) {
        app.beginUndoGroup("Vibrance MG: " + segName);

        var comp = app.project.items.addComp(segName, CFG.w, CFG.h, 1, 4, CFG.fps);
        addSolid(comp, CFG.bg, "BG", CFG.w, CFG.h);
        segFn(comp, 0.3);

        comp.openInViewer();
        app.endUndoGroup();
    }

    // ─────────────────────────────────────────────
    // ScriptUI パネル
    // ─────────────────────────────────────────────
    function createUI(thisObj) {
        var win = (thisObj instanceof Panel)
            ? thisObj
            : new Window("palette", "Vibrance MG Generator", undefined, { resizeable: true });

        win.orientation  = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 8;
        win.margins = 14;

        // タイトル
        var header = win.add("group");
        header.orientation = "column";
        header.alignChildren = "center";
        var title = header.add("statictext", undefined, "Vibrance MG Generator");
        title.graphics.font = ScriptUI.newFont("dialog", "BOLD", 13);
        header.add("statictext", undefined, "v1.0  —  AE ExtendScript");

        win.add("panel");

        // 全生成ボタン
        var allBtn = win.add("button", undefined, "▶  Generate ALL Segments  (30s comp)");
        allBtn.onClick = buildAll;

        win.add("statictext", undefined, "─ または個別セグメントのみ ─").justify = "center";

        // セグメント個別ボタン
        var segs = [
            ["S01 アーク弧線",        function(c, t){ seg01_arcLine(c, t); }         ],
            ["S02 縦バー群",           function(c, t){ seg02_verticalBars(c, t); }    ],
            ["S03 グラデブロック",      function(c, t){ seg03_gradBlocks(c, t); }      ],
            ["S04 3D折りたたみパネル", function(c, t){ seg04_foldedPanels(c, t); }    ],
            ["S05 球体クラスター",      function(c, t){ seg05_sphereCluster(c, t); }   ],
            ["S06 コイン/ディスク",     function(c, t){ seg06_coins(c, t); }           ],
            ["S07 アウトラインサークル",function(c, t){ seg07_outlineCircles(c, t); }  ],
            ["S08 曲がりリボン",        function(c, t){ seg08_bentRibbon(c, t); }      ],
            ["S09 花びら回転",          function(c, t){ seg09_flowerPetals(c, t); }    ],
            ["S10 軌道楕円+花",        function(c, t){ seg10_orbitalFlower(c, t); }   ],
            ["S11 グリーングローブ",    function(c, t){ seg11_globe(c, t); }           ],
            ["S12 フルブリードトーラス",function(c, t){ seg12_torusFullBleed(c, t); }  ],
        ];

        var grid = win.add("group");
        grid.orientation  = "column";
        grid.alignChildren = "fill";
        grid.spacing = 3;

        for (var i = 0; i < segs.length; i++) {
            (function(label, fn) {
                var btn = grid.add("button", undefined, label);
                btn.onClick = function() { buildSingle(fn, label); };
            })(segs[i][0], segs[i][1]);
        }

        win.add("panel");

        // 設定メモ
        var note = win.add("statictext", undefined,
            "※ CC Sphere / CC Cylinder はネイティブAEエフェクト\n" +
            "　 対応バージョン: AE 2021 以降推奨",
            { multiline: true }
        );
        note.graphics.foregroundColor = note.graphics.newPen(
            note.graphics.PenType.SOLID_COLOR, [0.5, 0.5, 0.5], 1
        );

        if (win instanceof Window) {
            win.center();
            win.show();
        } else {
            win.layout.layout(true);
        }
        return win;
    }

    createUI(thisObj);

}(this));
