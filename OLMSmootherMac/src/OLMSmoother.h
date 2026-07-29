/*
 * OLMSmoother.h
 * ---------------------------------------------------------------------------
 * OLM Smoother v2 の Mac(After Effects SDK) 向けクリーンルーム実装。
 * パラメータ定義・共通宣言をまとめたヘッダ。
 *
 * オリジナル: OLM Smoother v2 (C) OLM Digital, Inc. / Apache License 2.0
 * 本実装はオリジナルバイナリを逆コンパイルせず、公開マニュアルの仕様のみに
 * 基づいて記述したものです。
 * ---------------------------------------------------------------------------
 */

#pragma once

#include "AEConfig.h"
#include "entry.h"
#include "AE_Effect.h"
#include "AE_EffectCB.h"
#include "AE_Macros.h"
#include "Param_Utils.h"
#include "AE_EffectCBSuites.h"
#include "String_Utils.h"
#include "AE_GeneralPlug.h"
#include "AEFX_ChannelDepthTpl.h"
#include "AEGP_SuiteHandler.h"

/* プラグインのバージョン情報（About / GLOBAL_SETUP で使用） */
#define OLMSM_NAME              "OLM Smoother v2"
#define OLMSM_DESCRIPTION       "Smooth images. (Mac clean-room clone / Apache-2.0)"
#define OLMSM_CATEGORY          "OLM Plug-ins"

#define OLMSM_MAJOR_VERSION     2
#define OLMSM_MINOR_VERSION     0
#define OLMSM_BUG_VERSION       0
#define OLMSM_STAGE_VERSION     PF_Stage_DEVELOP
#define OLMSM_BUILD_VERSION     1

/*
 * パラメータのインデックス。
 * PF_Cmd_PARAMS_SETUP で ADD した順番と 1:1 で対応させること。
 * 0 番は必ず入力レイヤー(INPUT)。
 */
enum {
    OLMSM_INPUT = 0,            /* i/o layer (必須・自動)                */
    OLMSM_USE_COLOR_KEY,       /* Enable Color Key      (checkbox)      */
    OLMSM_COLOR_KEY,           /* Color Key             (color)         */
    OLMSM_INVERT_COLOR_KEY,    /* Invert Color Key      (checkbox)      */
    OLMSM_SMOOTHNESS,          /* Smoothness 0-100      (float slider)  */
    OLMSM_EXTRA_SMOOTH,        /* Extra Smooth          (checkbox)      */
    OLMSM_SMOOTHER_VERSION,    /* Smoother Version v1/v2 (popup)        */
    OLMSM_SMOOTH_RANGE,        /* Smooth Range 0-255    (float slider)  */
    OLMSM_GAMMA_CORRECTION,    /* Gamma Correction      (popup)         */
    OLMSM_GAMMA_VALUE,         /* Gamma Value           (float slider)  */
    OLMSM_NUM_GAMMA_COLORS,    /* Number of Gamma Colors (slider)       */
    OLMSM_GAMMA_COLOR,         /* Gamma Color           (color)         */

    OLMSM_NUM_PARAMS           /* パラメータ総数（自動計算用）           */
};

/* ディスク上のパラメータ ID（順番を変えても既存プロジェクトが壊れないように） */
enum {
    USE_COLOR_KEY_DISK_ID = 1,
    COLOR_KEY_DISK_ID,
    INVERT_COLOR_KEY_DISK_ID,
    SMOOTHNESS_DISK_ID,
    EXTRA_SMOOTH_DISK_ID,
    SMOOTHER_VERSION_DISK_ID,
    SMOOTH_RANGE_DISK_ID,
    GAMMA_CORRECTION_DISK_ID,
    GAMMA_VALUE_DISK_ID,
    NUM_GAMMA_COLORS_DISK_ID,
    GAMMA_COLOR_DISK_ID
};

/* Smoother Version ポップアップの選択肢 */
enum {
    OLMSM_VER_V1 = 1,
    OLMSM_VER_V2
};
#define OLMSM_VERSION_CHOICES "v1|v2"

/* Gamma Correction ポップアップの選択肢（.aex の文字列順に一致） */
enum {
    OLMSM_GAMMA_NONE = 1,
    OLMSM_GAMMA_COLORS,
    OLMSM_GAMMA_ALL
};
#define OLMSM_GAMMA_CHOICES "None|Gamma Colors|All Colors"

/* 各パラメータの既定値・範囲 */
#define OLMSM_SMOOTHNESS_MIN        0.0
#define OLMSM_SMOOTHNESS_MAX        100.0
#define OLMSM_SMOOTHNESS_DFLT       100.0

#define OLMSM_SMOOTH_RANGE_MIN      0.0
#define OLMSM_SMOOTH_RANGE_MAX      255.0
#define OLMSM_SMOOTH_RANGE_DFLT     0.0

#define OLMSM_GAMMA_VALUE_MIN       0.1
#define OLMSM_GAMMA_VALUE_MAX       10.0
#define OLMSM_GAMMA_VALUE_DFLT      2.4

#define OLMSM_NUM_GAMMA_COLORS_MIN  0
#define OLMSM_NUM_GAMMA_COLORS_MAX  16
#define OLMSM_NUM_GAMMA_COLORS_DFLT 0

/* レンダー時に全パラメータをまとめて渡す構造体 */
typedef struct {
    A_Boolean       use_color_key;
    PF_Pixel        color_key;          /* 8bit 参照色 */
    A_Boolean       invert_color_key;
    double          smoothness;         /* 0..100 */
    A_Boolean       extra_smooth;
    A_long          smoother_version;   /* OLMSM_VER_* */
    double          smooth_range;       /* 0..255 */
    A_long          gamma_correction;   /* OLMSM_GAMMA_* */
    double          gamma_value;
    A_long          num_gamma_colors;
    PF_Pixel        gamma_color;        /* 8bit 参照色 */
} OLMSmootherInfo;

/* プラグイン・エントリポイント（PiPL から呼ばれる） */
extern "C" {
    DllExport PF_Err EffectMain(
        PF_Cmd          cmd,
        PF_InData       *in_data,
        PF_OutData      *out_data,
        PF_ParamDef     *params[],
        PF_LayerDef     *output,
        void            *extra);
}
