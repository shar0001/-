/*
 * OLMSmoother.cpp
 * ---------------------------------------------------------------------------
 * OLM Smoother v2 の Mac(After Effects SDK) 向けクリーンルーム実装（本体）。
 *
 *   - PF_Cmd_PARAMS_SETUP : UI を公式 .aex と同一に定義
 *   - PF_Cmd_RENDER       : スムージング / ガンマ補正 / カラーキー を実行
 *
 * オリジナル: OLM Smoother v2 (C) OLM Digital, Inc. / Apache License 2.0
 * 本実装はオリジナルバイナリを逆コンパイルせず、公開マニュアルの仕様のみに
 * 基づいて記述したものです。画像処理アルゴリズムはマニュアル記載の挙動を
 * 再現する近似であり、出力の1ピクセル単位の完全一致は保証しません。
 * （Mac ビルド後、実映像で見比べて調整する前提です。）
 * ---------------------------------------------------------------------------
 */

#include "OLMSmoother.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

/* ======================================================================= */
/*  小さなユーティリティ                                                    */
/* ======================================================================= */

static inline double clamp01(double v) {
    return v < 0.0 ? 0.0 : (v > 1.0 ? 1.0 : v);
}

/* sRGB(0..1) -> Linear(0..1) */
static inline double srgb_to_linear(double c) {
    return (c <= 0.04045) ? (c / 12.92)
                          : pow((c + 0.055) / 1.055, 2.4);
}

/* Linear(0..1) -> sRGB(0..1) */
static inline double linear_to_srgb(double c) {
    return (c <= 0.0031308) ? (c * 12.92)
                            : (1.055 * pow(c, 1.0 / 2.4) - 0.055);
}

/* RGBA を float で持つ内部バッファの1ピクセル */
typedef struct { double r, g, b, a; } RGBAf;

/* ======================================================================= */
/*  About / Global Setup                                                    */
/* ======================================================================= */

static PF_Err About(
    PF_InData *in_data, PF_OutData *out_data,
    PF_ParamDef *params[], PF_LayerDef *output)
{
    AEGP_SuiteHandler suites(in_data->pica_basicP);
    suites.ANSICallbacksSuite1()->sprintf(
        out_data->return_msg,
        "%s v%d.%d\r%s\r"
        "Mac clean-room clone of OLM Smoother v2 (Apache-2.0).",
        OLMSM_NAME, OLMSM_MAJOR_VERSION, OLMSM_MINOR_VERSION, OLMSM_DESCRIPTION);
    return PF_Err_NONE;
}

static PF_Err GlobalSetup(
    PF_InData *in_data, PF_OutData *out_data,
    PF_ParamDef *params[], PF_LayerDef *output)
{
    out_data->my_version = PF_VERSION(OLMSM_MAJOR_VERSION,
                                      OLMSM_MINOR_VERSION,
                                      OLMSM_BUG_VERSION,
                                      OLMSM_STAGE_VERSION,
                                      OLMSM_BUILD_VERSION);

    /* 近傍参照するのでピクセル独立ではない。16bit(deep color) 対応。 */
    out_data->out_flags  = PF_OutFlag_DEEP_COLOR_AWARE;
    out_data->out_flags2 = PF_OutFlag2_NONE;

    return PF_Err_NONE;
}

/* ======================================================================= */
/*  Params Setup : UI を公式と同一に定義                                    */
/* ======================================================================= */

static PF_Err ParamsSetup(
    PF_InData *in_data, PF_OutData *out_data,
    PF_ParamDef *params[], PF_LayerDef *output)
{
    PF_Err          err = PF_Err_NONE;
    PF_ParamDef     def;

    /* 1. Enable Color Key */
    AEFX_CLR_STRUCT(def);
    PF_ADD_CHECKBOX("Enable Color Key", "",
                    FALSE, 0, USE_COLOR_KEY_DISK_ID);

    /* 2. Color Key */
    AEFX_CLR_STRUCT(def);
    PF_ADD_COLOR("Color Key", 0, 255, 0, COLOR_KEY_DISK_ID);   /* 既定=緑 */

    /* 3. Invert Color Key */
    AEFX_CLR_STRUCT(def);
    PF_ADD_CHECKBOX("Invert Color Key", "",
                    FALSE, 0, INVERT_COLOR_KEY_DISK_ID);

    /* 4. Smoothness (0-100) */
    AEFX_CLR_STRUCT(def);
    PF_ADD_FLOAT_SLIDERX("Smoothness",
                         OLMSM_SMOOTHNESS_MIN, OLMSM_SMOOTHNESS_MAX,
                         OLMSM_SMOOTHNESS_MIN, OLMSM_SMOOTHNESS_MAX,
                         OLMSM_SMOOTHNESS_DFLT,
                         PF_Precision_TENTHS, 0, 0, SMOOTHNESS_DISK_ID);

    /* 5. Extra Smooth */
    AEFX_CLR_STRUCT(def);
    PF_ADD_CHECKBOX("Extra Smooth", "",
                    FALSE, 0, EXTRA_SMOOTH_DISK_ID);

    /* 6. Smoother Version (v1|v2) */
    AEFX_CLR_STRUCT(def);
    PF_ADD_POPUP("Smoother Version",
                 2,                 /* 選択肢数 */
                 OLMSM_VER_V2,      /* 既定 = v2 */
                 OLMSM_VERSION_CHOICES,
                 SMOOTHER_VERSION_DISK_ID);

    /* 7. Smooth Range (0-255) */
    AEFX_CLR_STRUCT(def);
    PF_ADD_FLOAT_SLIDERX("Smooth Range",
                         OLMSM_SMOOTH_RANGE_MIN, OLMSM_SMOOTH_RANGE_MAX,
                         OLMSM_SMOOTH_RANGE_MIN, OLMSM_SMOOTH_RANGE_MAX,
                         OLMSM_SMOOTH_RANGE_DFLT,
                         PF_Precision_INTEGER, 0, 0, SMOOTH_RANGE_DISK_ID);

    /* 8. Gamma Correction (None|Gamma Colors|All Colors) */
    AEFX_CLR_STRUCT(def);
    PF_ADD_POPUP("Gamma Correction",
                 3,
                 OLMSM_GAMMA_NONE,  /* 既定 = None */
                 OLMSM_GAMMA_CHOICES,
                 GAMMA_CORRECTION_DISK_ID);

    /* 9. Gamma Value */
    AEFX_CLR_STRUCT(def);
    PF_ADD_FLOAT_SLIDERX("Gamma Value",
                         OLMSM_GAMMA_VALUE_MIN, OLMSM_GAMMA_VALUE_MAX,
                         OLMSM_GAMMA_VALUE_MIN, OLMSM_GAMMA_VALUE_MAX,
                         OLMSM_GAMMA_VALUE_DFLT,
                         PF_Precision_HUNDREDTHS, 0, 0, GAMMA_VALUE_DISK_ID);

    /* 10. Number of Gamma Colors */
    AEFX_CLR_STRUCT(def);
    PF_ADD_SLIDER("Number of Gamma Colors",
                  OLMSM_NUM_GAMMA_COLORS_MIN, OLMSM_NUM_GAMMA_COLORS_MAX,
                  OLMSM_NUM_GAMMA_COLORS_MIN, OLMSM_NUM_GAMMA_COLORS_MAX,
                  OLMSM_NUM_GAMMA_COLORS_DFLT, NUM_GAMMA_COLORS_DISK_ID);

    /* 11. Gamma Color */
    AEFX_CLR_STRUCT(def);
    PF_ADD_COLOR("Gamma Color", 0, 0, 0, GAMMA_COLOR_DISK_ID);  /* 既定=黒 */

    out_data->num_params = OLMSM_NUM_PARAMS;
    return err;
}

/* ======================================================================= */
/*  パラメータ読み出し                                                      */
/* ======================================================================= */

static void ReadInfo(PF_ParamDef *params[], OLMSmootherInfo *info)
{
    AEFX_CLR_STRUCT(*info);
    info->use_color_key    = params[OLMSM_USE_COLOR_KEY]->u.bd.value;
    info->color_key        = params[OLMSM_COLOR_KEY]->u.cd.value;
    info->invert_color_key = params[OLMSM_INVERT_COLOR_KEY]->u.bd.value;
    info->smoothness       = params[OLMSM_SMOOTHNESS]->u.fs_d.value;
    info->extra_smooth     = params[OLMSM_EXTRA_SMOOTH]->u.bd.value;
    info->smoother_version = params[OLMSM_SMOOTHER_VERSION]->u.pd.value;
    info->smooth_range     = params[OLMSM_SMOOTH_RANGE]->u.fs_d.value;
    info->gamma_correction = params[OLMSM_GAMMA_CORRECTION]->u.pd.value;
    info->gamma_value      = params[OLMSM_GAMMA_VALUE]->u.fs_d.value;
    info->num_gamma_colors = params[OLMSM_NUM_GAMMA_COLORS]->u.sd.value;
    info->gamma_color      = params[OLMSM_GAMMA_COLOR]->u.cd.value;
}

/* ======================================================================= */
/*  内部フロートバッファ入出力（8bit / 16bit 両対応）                       */
/* ======================================================================= */

/* 入力ワールドを RGBAf バッファへ。v2 なら RGB を sRGB->Linear に変換。 */
static void LoadToFloat(PF_LayerDef *in, RGBAf *buf, A_Boolean to_linear)
{
    const A_long W = in->width, H = in->height;
    const PF_Boolean deep = PF_WORLD_IS_DEEP(in);
    const double maxv = deep ? (double)PF_MAX_CHAN16 : (double)PF_MAX_CHAN8;

    for (A_long y = 0; y < H; ++y) {
        char *row = (char*)in->data + (size_t)y * in->rowbytes;
        for (A_long x = 0; x < W; ++x) {
            RGBAf *o = &buf[(size_t)y * W + x];
            double r, g, b, a;
            if (deep) {
                PF_Pixel16 *p = (PF_Pixel16*)row + x;
                r = p->red / maxv; g = p->green / maxv;
                b = p->blue / maxv; a = p->alpha / maxv;
            } else {
                PF_Pixel8 *p = (PF_Pixel8*)row + x;
                r = p->red / maxv; g = p->green / maxv;
                b = p->blue / maxv; a = p->alpha / maxv;
            }
            if (to_linear) { r = srgb_to_linear(r); g = srgb_to_linear(g); b = srgb_to_linear(b); }
            o->r = r; o->g = g; o->b = b; o->a = a;
        }
    }
}

/* RGBAf バッファを出力ワールドへ。v2 なら Linear->sRGB に戻す。 */
static void StoreFromFloat(PF_LayerDef *out, const RGBAf *buf,
                           A_long srcW, A_long srcH, A_Boolean from_linear)
{
    const A_long W = out->width, H = out->height;
    const PF_Boolean deep = PF_WORLD_IS_DEEP(out);
    const double maxv = deep ? (double)PF_MAX_CHAN16 : (double)PF_MAX_CHAN8;

    for (A_long y = 0; y < H; ++y) {
        char *row = (char*)out->data + (size_t)y * out->rowbytes;
        A_long sy = y < srcH ? y : srcH - 1;
        for (A_long x = 0; x < W; ++x) {
            A_long sx = x < srcW ? x : srcW - 1;
            const RGBAf *s = &buf[(size_t)sy * srcW + sx];
            double r = s->r, g = s->g, b = s->b, a = s->a;
            if (from_linear) { r = linear_to_srgb(r); g = linear_to_srgb(g); b = linear_to_srgb(b); }
            r = clamp01(r); g = clamp01(g); b = clamp01(b); a = clamp01(a);
            if (deep) {
                PF_Pixel16 *p = (PF_Pixel16*)row + x;
                p->red   = (A_u_short)(r * maxv + 0.5);
                p->green = (A_u_short)(g * maxv + 0.5);
                p->blue  = (A_u_short)(b * maxv + 0.5);
                p->alpha = (A_u_short)(a * maxv + 0.5);
            } else {
                PF_Pixel8 *p = (PF_Pixel8*)row + x;
                p->red   = (A_u_char)(r * maxv + 0.5);
                p->green = (A_u_char)(g * maxv + 0.5);
                p->blue  = (A_u_char)(b * maxv + 0.5);
                p->alpha = (A_u_char)(a * maxv + 0.5);
            }
        }
    }
}

/* ======================================================================= */
/*  画像処理パス                                                            */
/* ======================================================================= */

/* 8bit 参照色を 0..1 に正規化（必要なら linear 変換） */
static RGBAf NormRefColor(PF_Pixel c, A_Boolean to_linear) {
    RGBAf o;
    o.r = c.red / 255.0; o.g = c.green / 255.0; o.b = c.blue / 255.0; o.a = 1.0;
    if (to_linear) { o.r = srgb_to_linear(o.r); o.g = srgb_to_linear(o.g); o.b = srgb_to_linear(o.b); }
    return o;
}

/* 2色の RGB 距離（最大チャンネル差, 0..1） */
static inline double color_dist(const RGBAf *a, const RGBAf *b) {
    double dr = fabs(a->r - b->r), dg = fabs(a->g - b->g), db = fabs(a->b - b->b);
    double m = dr > dg ? dr : dg;
    return m > db ? m : db;
}

/* Color Key : 参照色に近いピクセルの alpha を 0 に（invert で反転） */
static void ApplyColorKey(RGBAf *buf, A_long W, A_long H,
                          const OLMSmootherInfo *info, A_Boolean to_linear)
{
    RGBAf key = NormRefColor(info->color_key, to_linear);
    /* Smooth Range を色差の許容量として流用（マニュアルの定義に準拠） */
    double tol = (info->smooth_range > 0.0 ? info->smooth_range : 8.0) / 255.0;
    for (size_t i = 0; i < (size_t)W * H; ++i) {
        double d = color_dist(&buf[i], &key);
        A_Boolean hit = (d <= tol);
        if (info->invert_color_key) hit = !hit;
        if (hit) buf[i].a = 0.0;
    }
}

/*
 * エッジを対象にした平滑化（ボカさずジャギーを取る近似）。
 *  - Smooth Range 以下の色差は「同じ色」とみなし平坦部として保護
 *  - 色差がそれを超える箇所(=線のエッジ)だけ、近傍平均へ Smoothness 分ブレンド
 *  - Extra Smooth 時はカーネルを 5x5 に拡大
 */
static void ApplySmoothing(RGBAf *src, RGBAf *dst, A_long W, A_long H,
                           const OLMSmootherInfo *info)
{
    const double range = info->smooth_range / 255.0;         /* 平坦とみなす閾値 */
    const double amt   = clamp01(info->smoothness / 100.0);  /* ブレンド強度      */
    const int    rad   = info->extra_smooth ? 2 : 1;         /* カーネル半径      */

    for (A_long y = 0; y < H; ++y) {
        for (A_long x = 0; x < W; ++x) {
            const size_t idx = (size_t)y * W + x;
            const RGBAf *c = &src[idx];

            double sr = 0, sg = 0, sb = 0, sa = 0, wsum = 0;
            double edge = 0.0;   /* 近傍との最大色差 = エッジ強度 */

            for (int dy = -rad; dy <= rad; ++dy) {
                A_long yy = y + dy; if (yy < 0) yy = 0; else if (yy >= H) yy = H - 1;
                for (int dx = -rad; dx <= rad; ++dx) {
                    A_long xx = x + dx; if (xx < 0) xx = 0; else if (xx >= W) xx = W - 1;
                    const RGBAf *n = &src[(size_t)yy * W + xx];
                    /* ガウシアン風の重み（中心ほど大） */
                    double w = 1.0 / (1.0 + dx * dx + dy * dy);
                    sr += n->r * w; sg += n->g * w; sb += n->b * w; sa += n->a * w;
                    wsum += w;
                    double d = color_dist(c, n);
                    if (d > edge) edge = d;
                }
            }
            RGBAf avg = { sr / wsum, sg / wsum, sb / wsum, sa / wsum };

            /* 平坦部(edge<=range)は保護し、エッジ部のみ平均へ寄せる */
            double t = 0.0;
            if (edge > range) {
                /* range を超えた分だけ滑らかに立ち上げる */
                double e = (edge - range) / (1.0 - range + 1e-6);
                t = amt * clamp01(e);
            }
            RGBAf *o = &dst[idx];
            o->r = c->r + (avg.r - c->r) * t;
            o->g = c->g + (avg.g - c->g) * t;
            o->b = c->b + (avg.b - c->b) * t;
            o->a = c->a + (avg.a - c->a) * t;
        }
    }
}

/*
 * ガンマ補正。
 *  - All Colors : 全ピクセルの RGB に pow(gamma) を適用（黒線が濃くなる）
 *  - Gamma Colors : Gamma Color に近い色のピクセルにのみ適用
 *  - None : 何もしない
 * Number of Gamma Colors は本クリーンルーム版では代表色1色(Gamma Color)を
 * 対象にする簡略実装。将来的に複数色リスト(arbitrary data)へ拡張予定。
 */
static void ApplyGamma(RGBAf *buf, A_long W, A_long H,
                       const OLMSmootherInfo *info, A_Boolean to_linear)
{
    if (info->gamma_correction == OLMSM_GAMMA_NONE) return;
    const double g = info->gamma_value > 0.0 ? info->gamma_value : 1.0;

    if (info->gamma_correction == OLMSM_GAMMA_ALL) {
        for (size_t i = 0; i < (size_t)W * H; ++i) {
            buf[i].r = pow(clamp01(buf[i].r), g);
            buf[i].g = pow(clamp01(buf[i].g), g);
            buf[i].b = pow(clamp01(buf[i].b), g);
        }
    } else { /* OLMSM_GAMMA_COLORS */
        RGBAf gc = NormRefColor(info->gamma_color, to_linear);
        const double tol = 0.25;   /* 対象色とみなす近さ */
        for (size_t i = 0; i < (size_t)W * H; ++i) {
            double d = color_dist(&buf[i], &gc);
            if (d <= tol) {
                double k = 1.0 - d / tol;   /* 近いほど強く効かせる */
                double rr = pow(clamp01(buf[i].r), g);
                double gg = pow(clamp01(buf[i].g), g);
                double bb = pow(clamp01(buf[i].b), g);
                buf[i].r += (rr - buf[i].r) * k;
                buf[i].g += (gg - buf[i].g) * k;
                buf[i].b += (bb - buf[i].b) * k;
            }
        }
    }
}

/* ======================================================================= */
/*  Render                                                                  */
/* ======================================================================= */

static PF_Err Render(
    PF_InData *in_data, PF_OutData *out_data,
    PF_ParamDef *params[], PF_LayerDef *output)
{
    PF_Err err = PF_Err_NONE;
    OLMSmootherInfo info;
    ReadInfo(params, &info);

    PF_LayerDef *in = &params[OLMSM_INPUT]->u.ld;
    const A_long W = in->width, H = in->height;
    if (W <= 0 || H <= 0) return err;

    /* v2 は sRGB<->Linear 変換を挟む。v1 は変換しない（マニュアル準拠）。 */
    const A_Boolean use_linear = (info.smoother_version == OLMSM_VER_V2);

    const size_t count = (size_t)W * H;
    RGBAf *bufA = (RGBAf*)malloc(count * sizeof(RGBAf));
    RGBAf *bufB = (RGBAf*)malloc(count * sizeof(RGBAf));
    if (!bufA || !bufB) { free(bufA); free(bufB); return PF_Err_OUT_OF_MEMORY; }

    /* 1) 読み込み（必要なら linear へ） */
    LoadToFloat(in, bufA, use_linear);

    /* 2) カラーキー */
    if (info.use_color_key)
        ApplyColorKey(bufA, W, H, &info, use_linear);

    /* 3) スムージング（bufA -> bufB） */
    RGBAf *result = bufA;
    if (info.smoothness > 0.0) {
        ApplySmoothing(bufA, bufB, W, H, &info);
        result = bufB;
        /* Extra Smooth の2パス目（さらに滑らかに） */
        if (info.extra_smooth) {
            ApplySmoothing(bufB, bufA, W, H, &info);
            result = bufA;
        }
    }

    /* 4) ガンマ補正 */
    if (info.gamma_correction != OLMSM_GAMMA_NONE)
        ApplyGamma(result, W, H, &info, use_linear);

    /* 5) 書き出し（必要なら sRGB へ戻す） */
    StoreFromFloat(output, result, W, H, use_linear);

    free(bufA);
    free(bufB);
    return err;
}

/* ======================================================================= */
/*  エントリポイント                                                        */
/* ======================================================================= */

extern "C" DllExport PF_Err EffectMain(
    PF_Cmd       cmd,
    PF_InData   *in_data,
    PF_OutData  *out_data,
    PF_ParamDef *params[],
    PF_LayerDef *output,
    void        *extra)
{
    PF_Err err = PF_Err_NONE;
    try {
        switch (cmd) {
            case PF_Cmd_ABOUT:         err = About(in_data, out_data, params, output);       break;
            case PF_Cmd_GLOBAL_SETUP:  err = GlobalSetup(in_data, out_data, params, output); break;
            case PF_Cmd_PARAMS_SETUP:  err = ParamsSetup(in_data, out_data, params, output); break;
            case PF_Cmd_RENDER:        err = Render(in_data, out_data, params, output);      break;
            default: break;
        }
    } catch (PF_Err &thrown_err) {
        err = thrown_err;
    }
    return err;
}
