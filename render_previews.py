# -*- coding: utf-8 -*-
"""
render_previews.py
===================
生成済みの output/output_world.blend から 3 カメラのプレビュー静止画を描画する
独立スクリプト。build_output_world.py の後、設定を変えず素早く見た目を確認する用途。

使い方 (macOS / ターミナル):
  # 保存済み .blend を開いて描画:
  /Applications/Blender.app/Contents/MacOS/Blender -b output/output_world.blend \
      -P render_previews.py
  # 最終品質 (1920x1080, MB/DOF ON, 各ショットの連番) で描画:
  ... -P render_previews.py -- --final
  # 特定ショットのみ最終描画:
  ... -P render_previews.py -- --final --shot 08

現在開いている .blend に対しても、そのまま実行できる。
"""

import bpy
import os
import sys

PREFIX = "OW_"
CAM_KEYS = ("06", "07", "08")
REP_FRAME = {"06": 24, "07": 50, "08": 96}
SHOT_RANGES = {"06": (1, 32), "07": (33, 64), "08": (65, 96)}
PREVIEW_NAMES = {"06": "preview_06_emergence",
                 "07": "preview_07_dive",
                 "08": "preview_08_hero"}


def log(msg, level="INFO"):
    print("[RENDER_PREVIEWS][%s] %s" % (level, msg))


def parse_args():
    argv = sys.argv
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    opts = {"final": False, "shot": None}
    i = 0
    while i < len(args):
        if args[i] == "--final":
            opts["final"] = True
        elif args[i] == "--shot" and i + 1 < len(args):
            opts["shot"] = args[i + 1]; i += 1
        i += 1
    return opts


def base_output_dir():
    if bpy.data.filepath:
        return os.path.dirname(bpy.data.filepath)
    return os.path.join(os.getcwd(), "output")


def get_cameras():
    cams = {}
    for key in CAM_KEYS:
        name = PREFIX + "CAM_" + key
        obj = bpy.data.objects.get(name)
        if obj is None:
            log("カメラが見つかりません: %s" % name, "WARN")
        cams[key] = obj
    return cams


def eevee_engine():
    try:
        items = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys()
    except Exception:
        items = []
    return "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in items else "BLENDER_EEVEE"


def set_motion_blur(scene, on):
    if hasattr(scene.render, "use_motion_blur"):
        scene.render.use_motion_blur = on
    if hasattr(scene, "eevee") and hasattr(scene.eevee, "use_motion_blur"):
        scene.eevee.use_motion_blur = on


def set_dof(scene, on):
    for obj in scene.objects:
        if obj.type == "CAMERA" and obj.name.startswith(PREFIX):
            obj.data.dof.use_dof = on


def apply_preview(scene):
    scene.render.engine = eevee_engine()
    scene.render.film_transparent = True
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 50    # 960x540
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    if hasattr(scene, "eevee"):
        try:
            scene.eevee.taa_render_samples = 16
        except Exception:
            pass
    set_motion_blur(scene, False)
    set_dof(scene, False)


def apply_final(scene):
    scene.render.engine = eevee_engine()
    scene.render.film_transparent = True
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.image_settings.color_mode = "RGBA"
    if hasattr(scene, "eevee"):
        try:
            scene.eevee.taa_render_samples = 64
        except Exception:
            pass
    set_motion_blur(scene, True)
    set_dof(scene, True)


def render_stills(scene, cams, out_dir):
    apply_preview(scene)
    preview_dir = os.path.join(out_dir, "previews")
    os.makedirs(preview_dir, exist_ok=True)
    for key in CAM_KEYS:
        if cams.get(key) is None:
            continue
        scene.camera = cams[key]
        scene.frame_set(REP_FRAME[key])
        scene.render.filepath = os.path.join(preview_dir, PREVIEW_NAMES[key] + ".png")
        try:
            bpy.ops.render.render(write_still=True)
            log("保存: %s.png" % PREVIEW_NAMES[key])
        except Exception as e:
            log("描画に失敗 (CAM_%s): %s" % (key, e), "ERROR")
            log("  ※ EEVEE のヘッドレス描画には GPU が必要です。GUI から実行してください。", "WARN")


def render_final(scene, shots, out_dir):
    apply_final(scene)
    render_dir = os.path.join(out_dir, "render")
    for key in shots:
        start, end = SHOT_RANGES[key]
        scene.frame_start, scene.frame_end = start, end
        shot_dir = os.path.join(render_dir, "shot_%s" % key)
        os.makedirs(shot_dir, exist_ok=True)
        scene.render.filepath = os.path.join(shot_dir, "shot_%s_" % key)
        try:
            bpy.ops.render.render(animation=True)
            log("最終レンダー完了: shot_%s (%d-%d)" % (key, start, end))
        except Exception as e:
            log("最終レンダーに失敗 (shot_%s): %s" % (key, e), "ERROR")


def main():
    opts = parse_args()
    scene = bpy.context.scene
    out_dir = base_output_dir()
    cams = get_cameras()
    if opts["final"]:
        shots = CAM_KEYS if not opts["shot"] or opts["shot"] == "all" else (opts["shot"],)
        shots = tuple(s for s in shots if s in SHOT_RANGES)
        render_final(scene, shots, out_dir)
    else:
        render_stills(scene, cams, out_dir)
    log("完了しました。")


if __name__ == "__main__":
    main()
