/**********************************************************************
 * Liquid Glass Rig Builder
 * ---------------------------------------------------------------
 * Apple UI 風「リキッドガラス」表現を After Effects 標準機能のみで
 * 自動構築する ScriptUI パネル / Run Script File 兼用スクリプト。
 *
 * 外部プラグイン不使用。日本語版 AE を強く意識した実装。
 *   - エフェクトは matchName 優先で追加
 *   - エフェクト制御の参照は effect("英語名")(1) でロケール非依存
 *   - 追従(位置/スケール/回転/不透明度)は transform.* でロケール非依存
 *   - パス追従はシェイプ複製 + ベイク名 content() 式 (try/catch フォールバック)
 *     + 「Refresh」ボタンで再ベイク可能
 *
 * 使い方:
 *   File > Scripts > Run Script File...  もしくは
 *   ScriptUI Panels フォルダに入れて Window メニューから起動
 *
 * 構成レイヤー (上→下):
 *   LG_CTRL              制御 Null (全パラメータの単一ソース)
 *   LG_RGB_R/G/B         色収差 (任意)
 *   LG_Edge_Highlight    フチの白ハイライト (Add)
 *   LG_Edge_Darkness     フチ内側の暗線 (Multiply)
 *   LG_Matte_Refr        屈折用トラックマット
 *   LG_Refraction        背景屈折(調整レイヤー: Bulge/Blur/CC Lens/Displace)
 *   LG_Main              ガラス本体 兼 パスの基準 (マスター)
 *   LG_Shadow            接地影
 *   --- 背景 ---
 **********************************************************************/

(function liquidGlassRigBuilder(thisObj) {

    // =================================================================
    // 0. 定数 / グローバル
    // =================================================================
    var SCRIPT_NAME = "Liquid Glass Rig Builder";
    var RIG_TAG      = "LGRIG";        // 生成レイヤーの目印 (layer.comment)
    var MAIN_TAG     = "LGRIG_MAIN";   // マスターレイヤーの目印
    var KAPPA        = 0.5522847498;   // ベジェ円近似係数

    // ラベルカラー (AE のラベル番号 1..16)
    var LABEL = {
        CTRL: 9,    // 緑
        MAIN: 14,   // シアン
        REFR: 11,   // 青
        EDGE: 4,    // 黄
        DARK: 3,    // 赤
        RGB:  8,    // 紫
        SHADOW: 1,  // 赤系
        MATTE: 5    // 水色
    };

    // モードプリセット:
    // [Blur, Refraction, LensBulge, EdgeHi, EdgeDark, Chroma, Frost, Opacity, Shadow]
    var MODES = {
        1: { name: "Soft UI Glass",      v: [4,  12,  8,  2.0, 1.5, 1, 5,  35, 30] },
        2: { name: "Thick Liquid Glass", v: [6,  30, 20,  4.0, 4.0, 2, 8,  25, 55] },
        3: { name: "Transition Lens",    v: [8,  40, 25,  3.0, 2.5, 6, 6,  30, 35] },
        4: { name: "Frosted Glass",      v: [22,  8,  6,  1.5, 1.5, 0, 30, 55, 25] },
        5: { name: "Minimal Clean Glass",v: [1.5, 6,  4,  1.0, 0.8, 0, 2,  18, 15] }
    };

    // CTRL スライダー名 -> プリセット配列 index の対応
    var SLIDER_ORDER = [
        "Blur Amount", "Refraction Strength", "Lens Bulge", "Edge Highlight",
        "Edge Darkness", "Chromatic Aberration", "Frost Amount", "Glass Opacity",
        "Shadow Strength"
    ];

    // =================================================================
    // 1. 汎用ユーティリティ
    // =================================================================

    function err(msg) {
        alert("[" + SCRIPT_NAME + "]\n\n" + msg);
    }

    /** アクティブな CompItem を返す。無ければ警告して null。 */
    function getActiveComp() {
        var c = app.project ? app.project.activeItem : null;
        if (!c || !(c instanceof CompItem)) {
            err("コンポジションを開いた状態で実行してください。\n(アクティブなコンポが見つかりません)");
            return null;
        }
        return c;
    }

    /** %CTRL% / %MAIN% トークンを実レイヤー名に置換して式文字列を返す。 */
    function EXPR(str, ctrlName, mainName) {
        str = str.replace(/%CTRL%/g, ctrlName);
        str = str.replace(/%MAIN%/g, mainName);
        return str;
    }

    /** 式を安全にセット (失敗しても続行)。 */
    function setExpr(prop, expr) {
        try {
            if (prop && prop.canSetExpression) prop.expression = expr;
        } catch (e) { /* ignore */ }
    }

    /** 値を安全にセット。 */
    function setVal(prop, val) {
        try { if (prop) prop.setValue(val); } catch (e) { /* ignore */ }
    }

    /** matchName でエフェクトを追加。失敗時 null。 */
    function addEffect(layer, matchName) {
        try {
            var parade = layer.property("ADBE Effect Parade");
            if (parade && parade.canAddProperty(matchName)) {
                return parade.addProperty(matchName);
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    /** 複数候補 matchName を順に試してエフェクト追加。 */
    function addEffectAny(layer, matchNames) {
        for (var i = 0; i < matchNames.length; i++) {
            var fx = addEffect(layer, matchNames[i]);
            if (fx) return fx;
        }
        return null;
    }

    /**
     * エフェクトのサブプロパティを名前 or index 候補で取得。
     * candidates: ["Slider", 1] のように名前/番号混在可。
     */
    function fxProp(fx, candidates) {
        if (!fx) return null;
        for (var i = 0; i < candidates.length; i++) {
            try {
                var p = fx.property(candidates[i]);
                if (p) return p;
            } catch (e) { /* ignore */ }
        }
        return null;
    }

    /** エフェクトサブプロパティに式をセット (候補式)。 */
    function setFxExpr(fx, candidates, expr) {
        var p = fxProp(fx, candidates);
        if (p) setExpr(p, expr);
        return p;
    }
    function setFxVal(fx, candidates, val) {
        var p = fxProp(fx, candidates);
        if (p) setVal(p, val);
        return p;
    }

    /** Slider Control を追加し英語名を付ける。 */
    function addSlider(ctrl, name, value) {
        var fx = addEffect(ctrl, "ADBE Slider Control");
        if (fx) {
            try { fx.name = name; } catch (e) {}
            setFxVal(fx, ["Slider", 1], value);
        }
        return fx;
    }

    /** Checkbox Control を追加。 */
    function addCheckbox(ctrl, name, value) {
        var fx = addEffect(ctrl, "ADBE Checkbox Control");
        if (fx) {
            try { fx.name = name; } catch (e) {}
            setFxVal(fx, ["Checkbox", 1], value ? 1 : 0);
        }
        return fx;
    }

    /**
     * Dropdown Menu Control を追加。未対応バージョンでは
     * Slider Control(1..n) にフォールバック。戻り値 {fx, isDropdown}.
     */
    function addDropdown(ctrl, name, items) {
        var fx = addEffect(ctrl, "ADBE Dropdown Control");
        if (fx) {
            try { fx.name = name; } catch (e) {}
            try {
                // 既定の項目を希望ラベルへ置換 (AE 2020.1+ )
                if (typeof fx.property(1).setPropertyParameters === "function") {
                    fx.property(1).setPropertyParameters(items);
                }
            } catch (e) { /* ignore: 既定の Item 1..3 のまま */ }
            return { fx: fx, isDropdown: true };
        }
        // フォールバック: Slider 1..n
        fx = addSlider(ctrl, name, 1);
        return { fx: fx, isDropdown: false };
    }

    // =================================================================
    // 2. シェイプ / パス ヘルパー
    // =================================================================

    /**
     * シェイプレイヤーから最初のベジェ Path を探し、
     * { groupName, pathName, pathProp } を返す。無ければ null。
     */
    function findPathInfo(shapeLayer) {
        try {
            var root = shapeLayer.property("ADBE Root Vectors Group");
            if (!root) return null;
            for (var i = 1; i <= root.numProperties; i++) {
                var grp = root.property(i);
                if (grp.matchName !== "ADBE Vector Group") continue;
                var vec = grp.property("ADBE Vectors Group");
                if (!vec) continue;
                for (var j = 1; j <= vec.numProperties; j++) {
                    var sub = vec.property(j);
                    if (sub.matchName === "ADBE Vector Shape - Group") {
                        var pp = sub.property("ADBE Vector Shape");
                        return {
                            groupName: grp.name,
                            pathName:  sub.name,
                            pathProp:  pp
                        };
                    }
                }
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    /** マスターのパス式 (try/catch でベイク値にフォールバック)。 */
    function buildPathExpr(mainName, info) {
        return 'var L = thisComp.layer("' + mainName + '");\n' +
               'try {\n' +
               '  L.content("' + info.groupName + '").content("' + info.pathName + '").path;\n' +
               '} catch (e) { value; }';
    }

    /** 角丸長方形のベジェ Shape を生成。 */
    function makeRoundedRectShape(w, h, r) {
        var hw = w / 2, hh = h / 2;
        r = Math.max(0, Math.min(r, Math.min(hw, hh)));
        var c = r * KAPPA;

        var v = [
            [-hw + r, -hh], [ hw - r, -hh],   // top edge
            [ hw, -hh + r], [ hw,  hh - r],   // right edge
            [ hw - r,  hh], [-hw + r,  hh],   // bottom edge
            [-hw,  hh - r], [-hw, -hh + r]    // left edge
        ];
        // in/out tangent (相対)
        var iT = [
            [-c, 0], [0, 0], [0, -c], [0, 0],
            [ c, 0], [0, 0], [0,  c], [0, 0]
        ];
        var oT = [
            [0, 0], [c, 0], [0, 0], [0, c],
            [0, 0], [-c, 0], [0, 0], [0, -c]
        ];
        var s = new Shape();
        s.vertices    = v;
        s.inTangents  = iT;
        s.outTangents = oT;
        s.closed      = true;
        return s;
    }

    /**
     * マスター(またはパス基準)に追従するシェイプレイヤーを生成。
     * opts: { name, fill:[r,g,b], fillOn, stroke:[r,g,b], strokeOn,
     *         label, comment }
     * pathShape: 初期ベイク用 Shape (省略可)
     * pathInfo : マスター側パス情報 (式リンク用, 省略可)
     */
    function createPathLinkedShape(comp, master, mainName, ctrlName, opts, pathShape, pathInfo) {
        var sl = comp.layers.addShape();
        sl.name = opts.name;
        try { sl.comment = opts.comment || RIG_TAG; } catch (e) {}
        try { if (opts.label != null) sl.label = opts.label; } catch (e) {}

        var root = sl.property("ADBE Root Vectors Group");
        var grp  = root.addProperty("ADBE Vector Group");
        try { grp.name = "Glass Group"; } catch (e) {}
        var vec  = grp.property("ADBE Vectors Group");

        var pathProp = vec.addProperty("ADBE Vector Shape - Group");
        var pp = pathProp.property("ADBE Vector Shape");

        // 初期ベイク (フォールバック用)
        if (pathShape) setVal(pp, pathShape);
        else if (master) {
            var mInfo = findPathInfo(master);
            if (mInfo && mInfo.pathProp) {
                try { setVal(pp, mInfo.pathProp.value); } catch (e) {}
            }
        }
        // 式リンク
        if (master && pathInfo) setExpr(pp, buildPathExpr(mainName, pathInfo));

        // Stroke (Fill より上に置くと外側に出る)
        if (opts.strokeOn) {
            var st = vec.addProperty("ADBE Vector Graphic - Stroke");
            setVal(st.property("ADBE Vector Stroke Color"),
                   [opts.stroke[0], opts.stroke[1], opts.stroke[2], 1]);
            setVal(st.property("ADBE Vector Stroke Width"), opts.strokeWidth || 4);
            // ライン端を丸く
            setVal(st.property("ADBE Vector Stroke Line Cap"), 2);
            setVal(st.property("ADBE Vector Stroke Line Join"), 2);
        }
        // Fill
        if (opts.fillOn) {
            var fl = vec.addProperty("ADBE Vector Graphic - Fill");
            setVal(fl.property("ADBE Vector Fill Color"),
                   [opts.fill[0], opts.fill[1], opts.fill[2], 1]);
        }

        // Transform 追従 (ロケール非依存アクセサ)
        if (master) linkTransform(sl, mainName);

        return sl;
    }

    /** 位置/スケール/回転/アンカーをマスターに式リンク。 */
    function linkTransform(layer, mainName) {
        var t = layer.property("ADBE Transform Group");
        setExpr(t.property("ADBE Position"),    'thisComp.layer("' + mainName + '").transform.position');
        setExpr(t.property("ADBE Scale"),       'thisComp.layer("' + mainName + '").transform.scale');
        setExpr(t.property("ADBE Rotate Z"),    'thisComp.layer("' + mainName + '").transform.rotation');
        setExpr(t.property("ADBE Anchor Point"),'thisComp.layer("' + mainName + '").transform.anchorPoint');
    }

    // =================================================================
    // 3. ビルダー (各レイヤー生成)
    // =================================================================

    /** マスターを生成 (デフォルトのピル型)。 */
    function createDefaultShape(comp, mainName, w, h, r) {
        var sl = comp.layers.addShape();
        sl.name = mainName;
        try { sl.comment = MAIN_TAG; } catch (e) {}
        try { sl.label = LABEL.MAIN; } catch (e) {}

        var root = sl.property("ADBE Root Vectors Group");
        var grp  = root.addProperty("ADBE Vector Group");
        try { grp.name = "Main Path"; } catch (e) {}
        var vec  = grp.property("ADBE Vectors Group");

        var pathProp = vec.addProperty("ADBE Vector Shape - Group");
        setVal(pathProp.property("ADBE Vector Shape"), makeRoundedRectShape(w, h, r));

        var fl = vec.addProperty("ADBE Vector Graphic - Fill");
        setVal(fl.property("ADBE Vector Fill Color"), [1, 1, 1, 1]);

        // 画面中央へ
        var t = sl.property("ADBE Transform Group");
        setVal(t.property("ADBE Position"), [comp.width / 2, comp.height / 2]);
        return sl;
    }

    /** 制御 Null を生成し全コントロールを追加。 */
    function createController(comp, ctrlName) {
        var nl = comp.layers.addNull();
        nl.name = ctrlName;
        try { nl.comment = RIG_TAG; } catch (e) {}
        try { nl.label = LABEL.CTRL; } catch (e) {}
        nl.guideLayer = true;
        try { nl.property("ADBE Transform Group").property("ADBE Opacity").setValue(0); } catch (e) {}

        // モード (Dropdown 優先 / Slider フォールバック)
        addDropdown(nl, "Glass Mode", [
            "1 Soft UI Glass", "2 Thick Liquid Glass", "3 Transition Lens",
            "4 Frosted Glass", "5 Minimal Clean Glass"
        ]);

        // メインパラメータ
        addSlider(nl, "Blur Amount",           MODES[1].v[0]);
        addSlider(nl, "Refraction Strength",   MODES[1].v[1]);
        addSlider(nl, "Lens Bulge",            MODES[1].v[2]);
        addSlider(nl, "Edge Highlight",        MODES[1].v[3]);
        addSlider(nl, "Edge Darkness",         MODES[1].v[4]);
        addSlider(nl, "Chromatic Aberration",  MODES[1].v[5]);
        addSlider(nl, "Frost Amount",          MODES[1].v[6]);
        addSlider(nl, "Glass Opacity",         MODES[1].v[7]);
        addSlider(nl, "Shadow Strength",       MODES[1].v[8]);

        // アニメーション/補助
        addSlider(nl, "Animation Elasticity",  18);
        addSlider(nl, "Lens Transition",       0);   // 0..1 トランジション量
        addSlider(nl, "Master Fade",           100); // 0..100 全体フェード

        // トグル
        addCheckbox(nl, "Use Chromatic RGB Split", 1);
        addCheckbox(nl, "Use Edge Glow",           1);
        addCheckbox(nl, "Use Inner Shadow",        1);

        return nl;
    }

    /** 屈折用調整レイヤー + そのトラックマットを生成。 */
    function createRefraction(comp, master, mainName, ctrlName, pathShape, pathInfo) {
        // --- 調整レイヤー (背景を歪ませる) ---
        var solid = comp.layers.addSolid([0, 0, 0], "tmp", comp.width, comp.height, comp.pixelAspect);
        solid.name = "LG_Refraction";
        solid.adjustmentLayer = true;
        try { solid.comment = RIG_TAG; } catch (e) {}
        try { solid.label = LABEL.REFR; } catch (e) {}

        // 1) Bulge : 凸レンズ + 背景拡大感
        var bulge = addEffect(solid, "ADBE BULGE");
        if (bulge) {
            // Horizontal/Vertical Radius, Bulge Height, Taper Radius, Bulge Center
            setFxExpr(bulge, ["Horizontal Radius", 1],
                'thisComp.layer("' + mainName + '").sourceRectAtTime().width * 0.62 + 10');
            setFxExpr(bulge, ["Vertical Radius", 2],
                'thisComp.layer("' + mainName + '").sourceRectAtTime().height * 0.62 + 10');
            setFxExpr(bulge, ["Bulge Height", 3],
                'var c=thisComp.layer("' + ctrlName + '");\n' +
                '(c.effect("Refraction Strength")(1)+c.effect("Lens Bulge")(1))/120 ' +
                '+ c.effect("Lens Transition")(1)*1.4');
            setFxExpr(bulge, ["Bulge Center", "Center", 5],
                'thisComp.layer("' + mainName + '").transform.position');
        }

        // 2) Fast Box Blur : 背景ブラー / フロスト
        var blur = addEffectAny(solid, ["ADBE Box Blur2", "ADBE Box Blur", "ADBE Gaussian Blur 2"]);
        if (blur) {
            setFxExpr(blur, ["Blur Radius", 1],
                'var c=thisComp.layer("' + ctrlName + '");\n' +
                'c.effect("Blur Amount")(1) + c.effect("Frost Amount")(1)*0.6');
            setFxVal(blur, ["Repeat Edge Pixels", 4], 1);
        }

        // 3) CC Lens : 転換用の強レンズ (待機時は Convergence=0 で無効)
        var ccl = addEffect(solid, "CC Lens");
        if (ccl) {
            setFxExpr(ccl, ["Center", 1],
                'thisComp.layer("' + mainName + '").transform.position');
            setFxExpr(ccl, ["Size", 2],
                'thisComp.layer("' + mainName + '").sourceRectAtTime().width * 0.9 + 50');
            setFxExpr(ccl, ["Convergence", 3],
                'thisComp.layer("' + ctrlName + '").effect("Lens Transition")(1) * 110');
        }

        // 4) Displacement Map : 微細な液体歪み (任意, 失敗時スキップ)
        try {
            var disp = addEffect(solid, "ADBE Displacement Map");
            // 後で createRefractionDisplace() からマップ層を割り当てる場合に備え保持
            solid.__dispFx = disp;
        } catch (e) {}

        // 不透明度 = Master Fade
        setExpr(solid.property("ADBE Transform Group").property("ADBE Opacity"),
            'clamp(thisComp.layer("' + ctrlName + '").effect("Master Fade")(1),0,100)');

        // --- トラックマット ---
        var matte = createPathLinkedShape(comp, master, mainName, ctrlName, {
            name: "LG_Matte_Refr", fillOn: true, fill: [1, 1, 1],
            strokeOn: false, label: LABEL.MATTE, comment: RIG_TAG
        }, pathShape, pathInfo);

        setTrackMatte(solid, matte, TrackMatteType.ALPHA);

        return { refraction: solid, matte: matte };
    }

    /** トラックマット設定 (新旧 API 両対応)。 */
    function setTrackMatte(target, matte, type) {
        try { matte.moveBefore(target); } catch (e) {}
        try {
            if (typeof target.setTrackMatte === "function") {
                target.setTrackMatte(matte, type);
            } else {
                target.trackMatteType = type;
            }
        } catch (e) { /* ignore */ }
    }

    /** フチの白ハイライト。 */
    function createEdgeHighlight(comp, master, mainName, ctrlName, pathShape, pathInfo) {
        var sl = createPathLinkedShape(comp, master, mainName, ctrlName, {
            name: "LG_Edge_Highlight", fillOn: false,
            strokeOn: true, stroke: [1, 1, 1], strokeWidth: 4,
            label: LABEL.EDGE, comment: RIG_TAG
        }, pathShape, pathInfo);

        // stroke 幅 (CTRL 連動)
        var stroke = findStroke(sl);
        if (stroke) setExpr(stroke.property("ADBE Vector Stroke Width"),
            'thisComp.layer("' + ctrlName + '").effect("Edge Highlight")(1)*2.5 + 1');

        var blur = addEffectAny(sl, ["ADBE Box Blur2", "ADBE Box Blur", "ADBE Gaussian Blur 2"]);
        if (blur) setFxExpr(blur, ["Blur Radius", 1],
            'thisComp.layer("' + ctrlName + '").effect("Edge Highlight")(1)*1.5 + 2');

        // 任意: Glow でにじみ
        try {
            var glow = addEffect(sl, "ADBE Glo2");
            if (glow) setFxExpr(glow, ["Glow Threshold", 1], '50');
        } catch (e) {}

        // 任意: CC Light Sweep で走る反射 (失敗してもOK)
        try {
            var sweep = addEffect(sl, "CC Light Sweep");
            if (sweep) {
                setFxExpr(sweep, ["Center", 1],
                    'thisComp.layer("' + mainName + '").transform.position');
                setFxVal(sweep, ["Width", 4], 60);
                setFxVal(sweep, ["Sweep Intensity", 6], 20);
            }
        } catch (e) {}

        sl.blendingMode = BlendingMode.ADD;
        setExpr(sl.property("ADBE Transform Group").property("ADBE Opacity"),
            'var c=thisComp.layer("' + ctrlName + '");\n' +
            'clamp(c.effect("Edge Highlight")(1)*25,0,100) * c.effect("Use Edge Glow")(1) ' +
            '* clamp(c.effect("Master Fade")(1),0,100)/100');
        return sl;
    }

    /** フチ内側の暗線 (厚みの陰)。 */
    function createEdgeDarkness(comp, master, mainName, ctrlName, pathShape, pathInfo) {
        var sl = createPathLinkedShape(comp, master, mainName, ctrlName, {
            name: "LG_Edge_Darkness", fillOn: false,
            strokeOn: true, stroke: [0.04, 0.06, 0.10], strokeWidth: 4,
            label: LABEL.DARK, comment: RIG_TAG
        }, pathShape, pathInfo);

        var stroke = findStroke(sl);
        if (stroke) setExpr(stroke.property("ADBE Vector Stroke Width"),
            'thisComp.layer("' + ctrlName + '").effect("Edge Darkness")(1)*2.5 + 1');

        var blur = addEffectAny(sl, ["ADBE Box Blur2", "ADBE Box Blur", "ADBE Gaussian Blur 2"]);
        if (blur) setFxExpr(blur, ["Blur Radius", 1],
            'thisComp.layer("' + ctrlName + '").effect("Edge Darkness")(1)*1.2 + 1.5');

        // 内側へわずかに縮める (内側の線に見せる)
        setExpr(sl.property("ADBE Transform Group").property("ADBE Scale"),
            'var s=thisComp.layer("' + mainName + '").transform.scale; [s[0]*0.975, s[1]*0.975]');

        sl.blendingMode = BlendingMode.MULTIPLY;
        setExpr(sl.property("ADBE Transform Group").property("ADBE Opacity"),
            'var c=thisComp.layer("' + ctrlName + '");\n' +
            'clamp(c.effect("Edge Darkness")(1)*22,0,100) * c.effect("Use Inner Shadow")(1) ' +
            '* clamp(c.effect("Master Fade")(1),0,100)/100');
        return sl;
    }

    /** シェイプレイヤー内の Stroke プロパティを探す。 */
    function findStroke(shapeLayer) {
        try {
            var root = shapeLayer.property("ADBE Root Vectors Group");
            for (var i = 1; i <= root.numProperties; i++) {
                var grp = root.property(i);
                if (grp.matchName !== "ADBE Vector Group") continue;
                var vec = grp.property("ADBE Vectors Group");
                for (var j = 1; j <= vec.numProperties; j++) {
                    if (vec.property(j).matchName === "ADBE Vector Graphic - Stroke")
                        return vec.property(j);
                }
            }
        } catch (e) {}
        return null;
    }

    /** RGB 色収差レイヤー (R/G/B) を生成。共有マットは Set Matte で参照。 */
    function createRGBSplit(comp, master, mainName, ctrlName, pathShape, pathInfo) {
        // 専用マット (video off, Set Matte 参照用)
        var cmatte = createPathLinkedShape(comp, master, mainName, ctrlName, {
            name: "LG_Matte_Chroma", fillOn: true, fill: [1, 1, 1],
            strokeOn: false, label: LABEL.MATTE, comment: RIG_TAG
        }, pathShape, pathInfo);
        try { cmatte.enabled = false; } catch (e) {}

        var made = [cmatte];
        var defs = [
            { name: "LG_RGB_R", keep: "R", sign:  1 },
            { name: "LG_RGB_G", keep: "G", sign:  0 },
            { name: "LG_RGB_B", keep: "B", sign: -1 }
        ];

        for (var i = 0; i < defs.length; i++) {
            var d = defs[i];
            var solid = comp.layers.addSolid([0, 0, 0], d.name, comp.width, comp.height, comp.pixelAspect);
            solid.name = d.name;
            solid.adjustmentLayer = true;
            try { solid.comment = RIG_TAG; } catch (e) {}
            try { solid.label = LABEL.RGB; } catch (e) {}

            // チャンネル分離
            var shift = addEffect(solid, "ADBE Shift Channels");
            if (shift) {
                // 1:Alpha 2:Red 3:Green 4:Blue  値 10=Full Off
                if (d.keep === "R") { setFxVal(shift, [3], 10); setFxVal(shift, [4], 10); }
                if (d.keep === "G") { setFxVal(shift, [2], 10); setFxVal(shift, [4], 10); }
                if (d.keep === "B") { setFxVal(shift, [2], 10); setFxVal(shift, [3], 10); }
            }
            // 位置オフセット
            var tr = addEffect(solid, "ADBE Geometry2");
            if (tr) {
                setFxExpr(tr, ["Position", 2],
                    'var c=thisComp.layer("' + ctrlName + '");\n' +
                    'var a=(c.effect("Chromatic Aberration")(1)+c.effect("Lens Transition")(1)*8)*' + d.sign + ';\n' +
                    '[thisComp.width/2 + a, thisComp.height/2]');
            }
            // Set Matte で形状に限定
            var setm = addEffect(solid, "ADBE Set Matte3");
            if (setm) {
                setFxVal(setm, ["Take Matte From Layer", 1], cmatte.index);
                setFxVal(setm, ["Use For Matte", 2], 4); // 4=Alpha
            }

            solid.blendingMode = BlendingMode.ADD;
            setExpr(solid.property("ADBE Transform Group").property("ADBE Opacity"),
                'var c=thisComp.layer("' + ctrlName + '");\n' +
                'clamp(c.effect("Chromatic Aberration")(1)*30,0,100) * c.effect("Use Chromatic RGB Split")(1) ' +
                '* clamp(c.effect("Master Fade")(1),0,100)/100');
            made.push(solid);
        }
        return made;
    }

    /** 接地影。 */
    function createShadow(comp, master, mainName, ctrlName, pathShape, pathInfo) {
        var sl = createPathLinkedShape(comp, master, mainName, ctrlName, {
            name: "LG_Shadow", fillOn: true, fill: [0.02, 0.03, 0.06],
            strokeOn: false, label: LABEL.SHADOW, comment: RIG_TAG
        }, pathShape, pathInfo);

        // 位置: マスター + 下方向オフセット (Shadow Strength 連動)
        setExpr(sl.property("ADBE Transform Group").property("ADBE Position"),
            'var c=thisComp.layer("' + ctrlName + '");\n' +
            'var p=thisComp.layer("' + mainName + '").transform.position;\n' +
            '[p[0], p[1] + 8 + c.effect("Shadow Strength")(1)*0.25]');

        var blur = addEffectAny(sl, ["ADBE Box Blur2", "ADBE Box Blur", "ADBE Gaussian Blur 2"]);
        if (blur) {
            setFxExpr(blur, ["Blur Radius", 1],
                'thisComp.layer("' + ctrlName + '").effect("Shadow Strength")(1)*0.8 + 12');
            setFxVal(blur, ["Repeat Edge Pixels", 4], 0);
        }
        setExpr(sl.property("ADBE Transform Group").property("ADBE Opacity"),
            'var c=thisComp.layer("' + ctrlName + '");\n' +
            'clamp(c.effect("Shadow Strength")(1),0,100) * clamp(c.effect("Master Fade")(1),0,100)/100');
        return sl;
    }

    // =================================================================
    // 4. オーケストレーション
    // =================================================================

    /**
     * リグ全体を構築。
     * opts: { prefix, width, height, roundness,
     *         useRGB, useShadow, useCtrl, preserve, master(optional) }
     */
    function buildRig(comp, opts) {
        var prefix   = opts.prefix || "LG_";
        var mainName = prefix + "Main";
        var ctrlName = prefix + "CTRL";

        // --- マスター決定 ---
        var master = opts.master || null;
        var pathShape = null;
        if (!master) {
            master = createDefaultShape(comp, mainName,
                opts.width || 520, opts.height || 200, opts.roundness || 100);
        } else {
            // 既存シェイプをマスター化
            try { master.name = mainName; } catch (e) {}
            try { master.comment = MAIN_TAG; } catch (e) {}
            try { master.label = LABEL.MAIN; } catch (e) {}
        }
        var pathInfo = findPathInfo(master);
        if (!pathInfo) {
            // パスが取れない(矩形/楕円パラメトリック等) → 複製ベイクのみ。
            // フォールバック用に現在のソース矩形からピル形状をベイク。
            try {
                var rect = master.sourceRectAtTime(comp.time, false);
                pathShape = makeRoundedRectShape(rect.width, rect.height,
                    Math.min(rect.width, rect.height) / 2);
            } catch (e) {}
        }

        // --- CTRL ---
        var ctrl = null;
        if (opts.useCtrl !== false) {
            ctrl = createController(comp, ctrlName);
        }

        // --- ガラス本体: マスター不透明度を CTRL 連動 ---
        if (ctrl) {
            setExpr(master.property("ADBE Transform Group").property("ADBE Opacity"),
                'var c=thisComp.layer("' + ctrlName + '");\n' +
                'clamp(c.effect("Glass Opacity")(1),0,100) * clamp(c.effect("Master Fade")(1),0,100)/100');
        }

        // --- 屈折 + マット ---
        var refr = createRefraction(comp, master, mainName, ctrlName, pathShape, pathInfo);

        // --- エッジ ---
        var edgeHi = createEdgeHighlight(comp, master, mainName, ctrlName, pathShape, pathInfo);
        var edgeDk = createEdgeDarkness(comp, master, mainName, ctrlName, pathShape, pathInfo);

        // --- RGB ---
        var rgb = [];
        if (opts.useRGB) {
            rgb = createRGBSplit(comp, master, mainName, ctrlName, pathShape, pathInfo);
        }

        // --- 影 ---
        var shadow = null;
        if (opts.useShadow) {
            shadow = createShadow(comp, master, mainName, ctrlName, pathShape, pathInfo);
        }

        // --- レイヤー順整理 ---
        arrangeLayers(comp, {
            ctrl: ctrl, rgb: rgb, edgeHi: edgeHi, edgeDk: edgeDk,
            matte: refr.matte, refraction: refr.refraction,
            master: master, shadow: shadow
        });

        // --- 初期モード適用 (Soft UI) ---
        if (ctrl) applyMode(ctrl, 1);

        return {
            ctrl: ctrl, master: master, refraction: refr.refraction,
            matte: refr.matte, edgeHi: edgeHi, edgeDk: edgeDk,
            rgb: rgb, shadow: shadow, mainName: mainName, ctrlName: ctrlName
        };
    }

    /** レイヤーを設計順に並べ替え。 */
    function arrangeLayers(comp, L) {
        // moveToBeginning で逆順に積むと最終的に望む順序になる。
        // 望む順 (上→下):
        //   CTRL, RGB_R/G/B, Matte_Chroma, EdgeHi, EdgeDark, Matte_Refr,
        //   Refraction, Master, Shadow
        // ここでは下から上へ moveToBeginning する。
        function top(layer) { try { if (layer) layer.moveToBeginning(); } catch (e) {} }

        if (L.shadow)     top(L.shadow);
        top(L.master);
        top(L.refraction);
        top(L.matte);
        if (L.edgeDk)     top(L.edgeDk);
        if (L.edgeHi)     top(L.edgeHi);
        if (L.rgb) for (var i = L.rgb.length - 1; i >= 0; i--) top(L.rgb[i]);
        if (L.ctrl)       top(L.ctrl);

        // トラックマット隣接の再保証
        try { setTrackMatte(L.refraction, L.matte, TrackMatteType.ALPHA); } catch (e) {}
    }

    // =================================================================
    // 5. モード / アニメーション / 更新 / クリーンアップ
    // =================================================================

    /** CTRL を探す (prefix 指定 or comment)。 */
    function findCtrl(comp, prefix) {
        var name = (prefix || "LG_") + "CTRL";
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === name) return comp.layer(i);
        }
        // フォールバック: Glass Mode を持つレイヤー
        for (var j = 1; j <= comp.numLayers; j++) {
            try {
                if (comp.layer(j).effect("Glass Mode")) return comp.layer(j);
            } catch (e) {}
        }
        return null;
    }

    /** モード適用 (CTRL スライダー値の書き換え)。 */
    function applyMode(ctrl, modeIndex) {
        if (!ctrl) return;
        var preset = MODES[modeIndex];
        if (!preset) return;
        for (var i = 0; i < SLIDER_ORDER.length; i++) {
            try {
                var fx = ctrl.effect(SLIDER_ORDER[i]);
                if (fx) setFxVal(fx, ["Slider", 1], preset.v[i]);
            } catch (e) {}
        }
        // Glass Mode 表示も同期 (Dropdown/Slider どちらでも)
        try {
            var gm = ctrl.effect("Glass Mode");
            if (gm) {
                var p = fxProp(gm, ["Menu", "Slider", 1]);
                if (p) setVal(p, modeIndex);
            }
        } catch (e) {}
    }

    /** Pop In アニメーション (Scale 85→overshoot→100 + フェード)。 */
    function addPopAnimation(comp, rig) {
        var ctrl = rig.ctrl, master = rig.master;
        if (!master) return;
        var t0 = comp.time;
        var fps = comp.frameRate;
        var elastic = 5;
        try {
            var elP = fxProp(ctrl.effect("Animation Elasticity"), ["Slider", 1]);
            if (elP) elastic = elP.value;
        } catch (e) {}

        // Scale キーフレーム
        var scale = master.property("ADBE Transform Group").property("ADBE Scale");
        // 既存式があると衝突するためマスターには式無し前提
        var base = [100, 100];
        try { base = scale.value; } catch (e) {}
        var over = 100 + Math.max(2, elastic);
        scale.setValueAtTime(t0,                [base[0]*0.85, base[1]*0.85]);
        scale.setValueAtTime(t0 + 8/fps,        [base[0]*over/100, base[1]*over/100]);
        scale.setValueAtTime(t0 + 16/fps,       [base[0], base[1]]);
        easeKeys(scale);

        // Master Fade キーフレーム
        if (ctrl) {
            var mf = ctrl.effect("Master Fade");
            if (mf) {
                var p = fxProp(mf, ["Slider", 1]);
                if (p) {
                    p.setValueAtTime(t0,         0);
                    p.setValueAtTime(t0 + 8/fps, 100);
                    easeKeys(p);
                }
            }
        }
    }

    /** Lens Transition アニメーション (中央から拡大 + 色収差/レンズピーク)。 */
    function addLensTransition(comp, rig) {
        var ctrl = rig.ctrl, master = rig.master;
        if (!master || !ctrl) return;
        var t0 = comp.time;
        var fps = comp.frameRate;

        // Scale: 小 → 100
        var scale = master.property("ADBE Transform Group").property("ADBE Scale");
        var base = [100, 100];
        try { base = scale.value; } catch (e) {}
        scale.setValueAtTime(t0,          [base[0]*0.2, base[1]*0.2]);
        scale.setValueAtTime(t0 + 20/fps, [base[0], base[1]]);
        easeKeys(scale);

        // Lens Transition: 0 → 1 (peak @10f) → 0
        var lt = ctrl.effect("Lens Transition");
        if (lt) {
            var p = fxProp(lt, ["Slider", 1]);
            if (p) {
                p.setValueAtTime(t0,          0);
                p.setValueAtTime(t0 + 10/fps, 1);
                p.setValueAtTime(t0 + 20/fps, 0);
                easeKeys(p);
            }
        }
    }

    /** 全キーに Easy Ease。 */
    function easeKeys(prop) {
        try {
            for (var i = 1; i <= prop.numKeys; i++) {
                prop.setInterpolationTypeAtKey(i, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
                var ein = [new KeyframeEase(0, 60)];
                var eout = [new KeyframeEase(0, 60)];
                // 多次元対応
                var dim = 1;
                try { dim = prop.value.length; } catch (e) { dim = 1; }
                if (dim > 1) {
                    ein = []; eout = [];
                    for (var d = 0; d < dim; d++) { ein.push(new KeyframeEase(0, 60)); eout.push(new KeyframeEase(0, 60)); }
                }
                prop.setTemporalEaseAtKey(i, ein, eout);
            }
        } catch (e) {}
    }

    /**
     * Main Shape からパスを再ベイク (リグ更新)。
     * 既存生成レイヤーのパスを現在のマスターパスで更新。
     */
    function refreshRig(comp, prefix) {
        var mainName = (prefix || "LG_") + "Main";
        var master = null;
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).name === mainName) { master = comp.layer(i); break; }
        }
        if (!master) { err("マスター(" + mainName + ")が見つかりません。"); return; }
        var info = findPathInfo(master);
        var shape = null;
        if (info && info.pathProp) { try { shape = info.pathProp.value; } catch (e) {} }
        if (!shape) {
            try {
                var rect = master.sourceRectAtTime(comp.time, false);
                shape = makeRoundedRectShape(rect.width, rect.height, Math.min(rect.width, rect.height)/2);
            } catch (e) {}
        }
        if (!shape) { err("マスターのパスを取得できませんでした。"); return; }

        var count = 0;
        for (var k = 1; k <= comp.numLayers; k++) {
            var ly = comp.layer(k);
            if (!(ly instanceof ShapeLayer)) continue;
            if (ly === master) continue;
            if (("" + ly.comment).indexOf(RIG_TAG) < 0) continue;
            var pp = getFirstPathProp(ly);
            if (pp) {
                // 式があるなら値で上書きせず式を維持。式が無い/無効ならベイク。
                if (!pp.expressionEnabled || pp.expression === "") {
                    setVal(pp, shape);
                    count++;
                }
            }
        }
        alert("[" + SCRIPT_NAME + "]\nリグを更新しました。\nベイク更新したパス: " + count + " 件\n" +
              "(式リンク中のレイヤーは自動追従するため対象外)");
    }

    function getFirstPathProp(shapeLayer) {
        var info = findPathInfo(shapeLayer);
        return info ? info.pathProp : null;
    }

    /** 生成レイヤーを削除。preserveMain=true ならマスター保持。 */
    function cleanupRig(comp, prefix, preserveMain) {
        var removed = 0;
        for (var i = comp.numLayers; i >= 1; i--) {
            var ly = comp.layer(i);
            var cm = "" + ly.comment;
            if (cm.indexOf(MAIN_TAG) >= 0) {
                if (!preserveMain) { ly.remove(); removed++; }
                else {
                    // 式とコメントを解除して通常シェイプへ戻す
                    try { ly.comment = ""; } catch (e) {}
                    clearExpressions(ly);
                }
                continue;
            }
            if (cm.indexOf(RIG_TAG) >= 0) { ly.remove(); removed++; }
        }
        return removed;
    }

    function clearExpressions(layer) {
        try {
            var t = layer.property("ADBE Transform Group");
            var props = ["ADBE Position", "ADBE Scale", "ADBE Rotate Z", "ADBE Anchor Point", "ADBE Opacity"];
            for (var i = 0; i < props.length; i++) {
                var p = t.property(props[i]);
                if (p && p.expressionEnabled) p.expression = "";
            }
        } catch (e) {}
    }

    // =================================================================
    // 6. 入口 (選択判定 -> ビルド)
    // =================================================================

    function runBuildFromSelection(opts) {
        var comp = getActiveComp();
        if (!comp) return;
        app.beginUndoGroup("Liquid Glass: Build from Selection");
        try {
            var master = null;
            var sel = comp.selectedLayers;
            if (sel && sel.length > 0) {
                if (sel[0] instanceof ShapeLayer) {
                    master = sel[0];
                } else {
                    err("選択レイヤーがシェイプレイヤーではありません。\n" +
                        "シェイプレイヤーを選択するか、Default Pill を使用してください。\n" +
                        "→ 選択なしのデフォルトピルで続行します。");
                    master = null;
                }
            }
            opts.master = master;
            var rig = buildRig(comp, opts);
            if (!master) {
                // 選択が無かった旨は警告済み。デフォルト生成完了。
            }
        } catch (e) {
            err("ビルド中にエラー: " + e.toString() + "\n(line " + (e.line || "?") + ")");
        }
        app.endUndoGroup();
    }

    function runBuildDefault(opts) {
        var comp = getActiveComp();
        if (!comp) return;
        app.beginUndoGroup("Liquid Glass: Default Pill");
        try {
            opts.master = null;
            buildRig(comp, opts);
        } catch (e) {
            err("ビルド中にエラー: " + e.toString());
        }
        app.endUndoGroup();
    }

    function runApplyMode(prefix, modeIndex) {
        var comp = getActiveComp();
        if (!comp) return;
        app.beginUndoGroup("Liquid Glass: Apply Mode");
        try {
            var ctrl = findCtrl(comp, prefix);
            if (!ctrl) { err("LG_CTRL が見つかりません。先にリグを作成してください。"); }
            else applyMode(ctrl, modeIndex);
        } catch (e) { err("モード適用エラー: " + e.toString()); }
        app.endUndoGroup();
    }

    function runAnim(prefix, kind) {
        var comp = getActiveComp();
        if (!comp) return;
        app.beginUndoGroup("Liquid Glass: Animation");
        try {
            var ctrl = findCtrl(comp, prefix);
            var mainName = (prefix || "LG_") + "Main";
            var master = null;
            for (var i = 1; i <= comp.numLayers; i++)
                if (comp.layer(i).name === mainName) { master = comp.layer(i); break; }
            if (!master) { err("マスター(" + mainName + ")が見つかりません。"); }
            else {
                var rig = { ctrl: ctrl, master: master };
                if (kind === "pop") addPopAnimation(comp, rig);
                else if (kind === "lens") addLensTransition(comp, rig);
            }
        } catch (e) { err("アニメーション付与エラー: " + e.toString()); }
        app.endUndoGroup();
    }

    function runRefresh(prefix) {
        var comp = getActiveComp();
        if (!comp) return;
        app.beginUndoGroup("Liquid Glass: Refresh");
        try { refreshRig(comp, prefix); }
        catch (e) { err("更新エラー: " + e.toString()); }
        app.endUndoGroup();
    }

    function runCleanup(prefix, preserveMain) {
        var comp = getActiveComp();
        if (!comp) return;
        app.beginUndoGroup("Liquid Glass: Cleanup");
        try {
            var n = cleanupRig(comp, prefix, preserveMain);
            alert("[" + SCRIPT_NAME + "]\n" + n + " 個の生成レイヤーを削除しました。");
        } catch (e) { err("クリーンアップエラー: " + e.toString()); }
        app.endUndoGroup();
    }

    // =================================================================
    // 7. ScriptUI パネル
    // =================================================================

    function buildUI(thisObj) {
        var pal = (thisObj instanceof Panel)
            ? thisObj
            : new Window("palette", SCRIPT_NAME, undefined, { resizeable: true });
        if (pal === null) return;

        pal.orientation = "column";
        pal.alignChildren = ["fill", "top"];
        pal.spacing = 6;
        pal.margins = 10;

        // --- 入力項目 ---
        var gIn = pal.add("panel", undefined, "Settings");
        gIn.orientation = "column";
        gIn.alignChildren = ["fill", "top"];
        gIn.margins = 10;

        function row(parent, label, def, chars) {
            var g = parent.add("group");
            g.orientation = "row";
            g.alignChildren = ["left", "center"];
            var st = g.add("statictext", undefined, label);
            st.preferredSize.width = 110;
            var et = g.add("edittext", undefined, def);
            et.characters = chars || 8;
            return et;
        }

        var inPrefix = row(gIn, "Rig Name Prefix", "LG_", 8);
        var inW      = row(gIn, "Default Width", "520", 6);
        var inH      = row(gIn, "Default Height", "200", 6);
        var inR      = row(gIn, "Default Roundness", "100", 6);

        // --- チェックボックス ---
        var gChk = pal.add("panel", undefined, "Options");
        gChk.orientation = "column";
        gChk.alignChildren = ["left", "top"];
        gChk.margins = 10;
        var cbPreserve = gChk.add("checkbox", undefined, "Preserve Original Shape");
        var cbRGB      = gChk.add("checkbox", undefined, "Create RGB Split Layers");
        var cbShadow   = gChk.add("checkbox", undefined, "Create Shadow");
        var cbCtrl     = gChk.add("checkbox", undefined, "Create Controller Null");
        cbPreserve.value = true;
        cbRGB.value      = true;
        cbShadow.value   = true;
        cbCtrl.value     = true;

        // --- モード選択 ---
        var gMode = pal.add("group");
        gMode.orientation = "row";
        gMode.add("statictext", undefined, "Glass Mode:");
        var ddMode = gMode.add("dropdownlist", undefined, [
            "1 Soft UI Glass", "2 Thick Liquid Glass", "3 Transition Lens",
            "4 Frosted Glass", "5 Minimal Clean Glass"
        ]);
        ddMode.selection = 0;

        function collectOpts() {
            return {
                prefix:    (inPrefix.text || "LG_"),
                width:     parseFloat(inW.text) || 520,
                height:    parseFloat(inH.text) || 200,
                roundness: parseFloat(inR.text) || 100,
                useRGB:    cbRGB.value,
                useShadow: cbShadow.value,
                useCtrl:   cbCtrl.value,
                preserve:  cbPreserve.value
            };
        }

        // --- ビルドボタン ---
        var gB1 = pal.add("panel", undefined, "Build");
        gB1.orientation = "column";
        gB1.alignChildren = ["fill", "top"];
        gB1.margins = 8;

        var btnSel = gB1.add("button", undefined, "Create Glass Rig from Selection");
        var btnDef = gB1.add("button", undefined, "Create Default Pill Glass");

        // --- 適用/更新 ---
        var gB2 = pal.add("panel", undefined, "Modify");
        gB2.orientation = "column";
        gB2.alignChildren = ["fill", "top"];
        gB2.margins = 8;

        var btnMode    = gB2.add("button", undefined, "Apply Mode to Existing Rig");
        var btnRefresh = gB2.add("button", undefined, "Refresh Rig from Main Shape");

        // --- アニメーション ---
        var gB3 = pal.add("panel", undefined, "Animation");
        gB3.orientation = "column";
        gB3.alignChildren = ["fill", "top"];
        gB3.margins = 8;

        var btnPop  = gB3.add("button", undefined, "Add Pop In Animation");
        var btnLens = gB3.add("button", undefined, "Add Lens Transition Animation");

        // --- クリーンアップ ---
        var gB4 = pal.add("panel", undefined, "Cleanup");
        gB4.orientation = "column";
        gB4.alignChildren = ["fill", "top"];
        gB4.margins = 8;
        var btnClean = gB4.add("button", undefined, "Clean Generated Rig");

        // --- ハンドラ ---
        btnSel.onClick = function () { runBuildFromSelection(collectOpts()); };
        btnDef.onClick = function () { runBuildDefault(collectOpts()); };
        btnMode.onClick = function () {
            runApplyMode(inPrefix.text || "LG_", (ddMode.selection ? ddMode.selection.index : 0) + 1);
        };
        btnRefresh.onClick = function () { runRefresh(inPrefix.text || "LG_"); };
        btnPop.onClick  = function () { runAnim(inPrefix.text || "LG_", "pop"); };
        btnLens.onClick = function () { runAnim(inPrefix.text || "LG_", "lens"); };
        btnClean.onClick = function () { runCleanup(inPrefix.text || "LG_", cbPreserve.value); };

        // --- 表示 ---
        if (pal instanceof Window) {
            pal.center();
            pal.show();
        } else {
            pal.layout.layout(true);
            pal.layout.resize();
        }
        return pal;
    }

    // =================================================================
    // 起動
    // =================================================================
    try {
        buildUI(thisObj);
    } catch (e) {
        err("起動エラー: " + e.toString());
    }

})(this);
