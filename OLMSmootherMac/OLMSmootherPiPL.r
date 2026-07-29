/*
 * OLMSmootherPiPL.r
 * ---------------------------------------------------------------------------
 * PiPL (Plug-in Property List) リソース定義。
 * After Effects がこのプラグインを「エフェクト > OLM Plug-ins > OLM Smoother v2」
 * として認識するために必要。Xcode ビルド時に Rez / PiPLtool でコンパイルされる。
 *
 * ※ AE SDK 付属サンプルの *PiPL.r と同じ場所・同じビルド設定で使うこと。
 * ---------------------------------------------------------------------------
 */

#include "AEConfig.h"
#include "AE_EffectVers.h"

#ifndef AE_OS_WIN
    #include <AE_General.r>
#endif

resource 'PiPL' (16000) {
    {
        /* over-ride the plug-in name / category */
        Kind { AEEffect },
        Name { "OLM Smoother v2" },
        Category { "OLM Plug-ins" },

#ifdef AE_OS_WIN
    #ifdef AE_PROC_INTELx64
        CodeWin64X86 { "EffectMain" },
    #endif
#else
        CodeMacIntel64 { "EffectMain" },
        CodeMacARM64   { "EffectMain" },
#endif

        /* エフェクトの仕様フラグ（GlobalSetup の out_flags と整合させる） */
        AE_PiPL_Version { 2, 0 },
        AE_Effect_Spec_Version { PF_PLUG_IN_VERSION, PF_PLUG_IN_SUBVERS },
        AE_Effect_Version {
            /* 2.0.0 : PF_VERSION(2,0,0,PF_Stage_DEVELOP,1) */
            525825      /* (2<<19)|(0<<15)|(0<<11)|(PF_Stage_DEVELOP<<9)|1 の一例。ビルド時に要確認 */
        },
        AE_Effect_Info_Flags { 0 },
        AE_Effect_Global_OutFlags { 0x02000000 },   /* DEEP_COLOR_AWARE */
        AE_Effect_Global_OutFlags_2 { 0x00000000 },

        AE_Effect_Match_Name { "OLM Smoother v2" },
        AE_Reserved_Info { 0 }
    }
};
