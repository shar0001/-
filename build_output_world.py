# -*- coding: utf-8 -*-
"""
build_output_world.py
======================
ストーリーボード後半3カット
  06 OUTPUT EMERGENCE
  07 DIVE THROUGH OUTPUT
  08 HERO REVEAL
のための、再実行可能な Blender 自動構築システム。

設計方針:
  * 何度実行しても重複が増えない (専用 Collection "OUTPUT_WORLD" と "OW_" 接頭辞の
    データブロックだけを破棄・再生成する。ユーザーの他データには一切触れない)
  * 1個の元 Cube を Geometry Nodes でインスタンス化 (Realize Instances 不使用)
  * 個別オブジェクトを数百・数千個作らない
  * ファイル削除は一切行わない。バックアップは copy2 によるコピーのみ
  * 可能な限り bpy.ops ではなく Blender Data API を使用する
    (例外はレンダリング bpy.ops.render.* とファイル保存 bpy.ops.wm.save_* のみ)

実行例 (macOS / ターミオナル):
  /Applications/Blender.app/Contents/MacOS/Blender -b -P build_output_world.py
  # 引数を渡す場合:
  ... -P build_output_world.py -- --config config.json --no-render

Blender 3.x / 4.x の API 差異を実行時に吸収する。
"""

import bpy
import os
import sys
import json
import math
import shutil
import traceback
from datetime import datetime

try:
    from mathutils import Vector
except Exception:  # pragma: no cover - Blender 実行時のみ import 可能
    Vector = None

# ---------------------------------------------------------------------------
# 定数
# ---------------------------------------------------------------------------
COLL_NAME = "OUTPUT_WORLD"     # 再生成する専用コレクション
PREFIX = "OW_"                 # 生成データブロックの接頭辞 (安全な purge の目印)

CAM_KEYS = ("06", "07", "08")
SHOT_RANGES = {"06": (1, 32), "07": (33, 64), "08": (65, 96)}
SHOT_MARKER_FRAME = {"06": 1, "07": 33, "08": 65}
REP_FRAME = {"06": 24, "07": 50, "08": 96}  # プレビュー静止画の代表フレーム
FRAME_START, FRAME_END = 1, 96
FPS = 24
BASE_RES_X, BASE_RES_Y = 1920, 1080
HERO_SPHERE_COUNT = 3

# ---------------------------------------------------------------------------
# ロギング
# ---------------------------------------------------------------------------
def log(msg, level="INFO"):
    print("[OUTPUT_WORLD][%s] %s" % (level, msg))


# ---------------------------------------------------------------------------
# パス / 設定
# ---------------------------------------------------------------------------
def script_dir():
    """このスクリプトのあるディレクトリ (config.json / output/ の基準)。"""
    try:
        return os.path.dirname(os.path.abspath(__file__))
    except Exception:
        # Text Editor から実行された等で __file__ が無い場合
        if bpy.data.filepath:
            return os.path.dirname(bpy.data.filepath)
        return os.getcwd()


DEFAULT_CONFIG = {
    "grid_x": 32, "grid_y": 32, "spacing": 1.2,
    "min_height": 0.5, "max_height": 8.0,
    "noise_scale": 1.5, "noise_strength": 2.2, "center_peak_strength": 6.0,
    "build_start_frame": 1, "build_end_frame": 32,
    "red_ratio": 0.015, "random_seed": 12345,
    "preview_resolution_percentage": 50, "final_resolution_percentage": 100,
    "output_format": "PNG",
}


def load_config(path):
    cfg = dict(DEFAULT_CONFIG)
    if path and os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                user = json.load(f)
            cfg.update({k: user[k] for k in user if k in DEFAULT_CONFIG})
            log("config.json を読み込みました: %s" % path)
        except Exception as e:
            log("config.json の読み込みに失敗しました (%s)。既定値を使用します。" % e, "WARN")
    else:
        log("config.json が見つかりません。既定値を使用します。", "WARN")

    # --- バリデーション (壊れた値でも安全に動作させる) -------------------
    cfg["grid_x"] = max(2, int(cfg["grid_x"]))
    cfg["grid_y"] = max(2, int(cfg["grid_y"]))
    cfg["spacing"] = max(0.01, float(cfg["spacing"]))
    cfg["min_height"] = max(0.0, float(cfg["min_height"]))
    cfg["max_height"] = max(cfg["min_height"] + 0.01, float(cfg["max_height"]))
    cfg["noise_scale"] = float(cfg["noise_scale"])
    cfg["noise_strength"] = float(cfg["noise_strength"])
    cfg["center_peak_strength"] = float(cfg["center_peak_strength"])
    cfg["build_start_frame"] = int(cfg["build_start_frame"])
    cfg["build_end_frame"] = max(cfg["build_start_frame"] + 1, int(cfg["build_end_frame"]))
    cfg["red_ratio"] = min(1.0, max(0.0, float(cfg["red_ratio"])))
    cfg["random_seed"] = int(cfg["random_seed"])
    cfg["preview_resolution_percentage"] = max(1, int(cfg["preview_resolution_percentage"]))
    cfg["final_resolution_percentage"] = max(1, int(cfg["final_resolution_percentage"]))
    fmt = str(cfg["output_format"]).upper()
    cfg["output_format"] = "OPEN_EXR" if fmt in ("EXR", "OPEN_EXR", "OPENEXR") else "PNG"
    return cfg


def parse_args():
    argv = sys.argv
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    opts = {"config": None, "render": True, "final": False, "shot": None}
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--config" and i + 1 < len(args):
            opts["config"] = args[i + 1]; i += 1
        elif a == "--no-render":
            opts["render"] = False
        elif a == "--final":
            opts["final"] = True
        elif a == "--shot" and i + 1 < len(args):
            opts["shot"] = args[i + 1]; i += 1
        i += 1
    return opts


# ---------------------------------------------------------------------------
# Blender バージョン差異ヘルパ
# ---------------------------------------------------------------------------
def eevee_engine():
    """利用可能な EEVEE エンジン識別子を返す (4.2+ は EEVEE Next)。"""
    try:
        items = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys()
    except Exception:
        items = []
    if "BLENDER_EEVEE_NEXT" in items:
        return "BLENDER_EEVEE_NEXT"
    return "BLENDER_EEVEE"


def ng_new_socket(ng, name, in_out, socket_type):
    """ノードグループの入出力ソケットを作成 (4.0+ interface / 3.x inputs-outputs)。"""
    if hasattr(ng, "interface"):
        return ng.interface.new_socket(name=name, in_out=in_out, socket_type=socket_type)
    if in_out == "INPUT":
        return ng.inputs.new(socket_type, name)
    return ng.outputs.new(socket_type, name)


def set_socket_default(node, name, value):
    """入力ソケットの default_value を安全に設定 (存在時のみ)。"""
    sock = node.inputs.get(name) if hasattr(node.inputs, "get") else None
    if sock is None:
        for s in node.inputs:
            if s.name == name:
                sock = s
                break
    if sock is not None and hasattr(sock, "default_value"):
        try:
            sock.default_value = value
            return True
        except Exception:
            return False
    return False


def first_enabled_output(node):
    for o in node.outputs:
        if getattr(o, "enabled", True):
            return o
    return node.outputs[0]


def set_principled(bsdf, name_options, value):
    for n in name_options:
        s = bsdf.inputs.get(n)
        if s is not None and hasattr(s, "default_value"):
            try:
                s.default_value = value
                return True
            except Exception:
                pass
    return False


# ---------------------------------------------------------------------------
# バックアップ (削除は一切しない / コピーのみ)
# ---------------------------------------------------------------------------
def make_backup(output_dir):
    target = os.path.join(output_dir, "output_world.blend")
    if os.path.isfile(target):
        backup_dir = os.path.join(output_dir, "backups")
        os.makedirs(backup_dir, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        dst = os.path.join(backup_dir, "output_world_%s.blend" % stamp)
        shutil.copy2(target, dst)
        log("既存の .blend をバックアップしました -> %s" % dst)
    else:
        log("バックアップ対象の既存 .blend はありません (新規作成)。")


# ---------------------------------------------------------------------------
# 安全な再生成 (OUTPUT_WORLD と OW_ 接頭辞データのみ破棄)
# ---------------------------------------------------------------------------
def purge_previous():
    """
    前回生成物のみを bpy.data から取り除く。
    * OUTPUT_WORLD コレクションにリンクされたオブジェクト
    * 名前が PREFIX("OW_") で始まる、参照 0 のデータブロック
    ファイルシステムには一切触れない。
    """
    removed = 0
    coll = bpy.data.collections.get(COLL_NAME)
    if coll:
        for obj in list(coll.objects):
            try:
                bpy.data.objects.remove(obj, do_unlink=True)
                removed += 1
            except Exception as e:
                log("オブジェクト削除に失敗: %s (%s)" % (obj.name, e), "WARN")
        # 親コレクションから unlink
        for parent in list(bpy.data.collections) + [s.collection for s in bpy.data.scenes]:
            if parent and coll.name in [c.name for c in parent.children]:
                try:
                    parent.children.unlink(coll)
                except Exception:
                    pass
        try:
            bpy.data.collections.remove(coll)
        except Exception as e:
            log("コレクション削除に失敗: %s" % e, "WARN")

    # OW_ 接頭辞の孤立データを掃除 (.001 重複防止)。参照が残るものは触らない。
    for datablocks in (bpy.data.node_groups, bpy.data.materials, bpy.data.meshes,
                       bpy.data.lights, bpy.data.cameras):
        for db in list(datablocks):
            if db.name.startswith(PREFIX) and db.users == 0:
                try:
                    datablocks.remove(db)
                except Exception:
                    pass
    log("前回生成物を破棄しました (削除オブジェクト数: %d)。" % removed)


def get_world_collection():
    coll = bpy.data.collections.new(COLL_NAME)
    bpy.context.scene.collection.children.link(coll)
    return coll


# ---------------------------------------------------------------------------
# ジオメトリ生成用の低レベルヘルパ
# ---------------------------------------------------------------------------
def make_rounded_cube_mesh():
    """底面を z=0 に置いた 1x1x1 の Cube メッシュ (ベベルは modifier で付与)。"""
    name = PREFIX + "SrcCube"
    me = bpy.data.meshes.get(name)
    if me is None:
        me = bpy.data.meshes.new(name)
    verts = [
        (-0.5, -0.5, 0.0), (0.5, -0.5, 0.0), (0.5, 0.5, 0.0), (-0.5, 0.5, 0.0),
        (-0.5, -0.5, 1.0), (0.5, -0.5, 1.0), (0.5, 0.5, 1.0), (-0.5, 0.5, 1.0),
    ]
    faces = [
        (0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1),
        (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0),
    ]
    me.clear_geometry()
    me.from_pydata(verts, [], faces)
    me.update()
    return me


def make_uv_sphere_mesh(name, segments=16, rings=12, radius=1.0):
    """発光球用の低ポリ UV スフィア (Data API のみ、bpy.ops 不使用)。"""
    me = bpy.data.meshes.get(name)
    if me is None:
        me = bpy.data.meshes.new(name)
    verts, faces = [], []
    verts.append((0.0, 0.0, radius))          # 北極
    for r in range(1, rings):
        phi = math.pi * r / rings
        z = radius * math.cos(phi)
        rad = radius * math.sin(phi)
        for s in range(segments):
            theta = 2.0 * math.pi * s / segments
            verts.append((rad * math.cos(theta), rad * math.sin(theta), z))
    verts.append((0.0, 0.0, -radius))         # 南極
    south = len(verts) - 1

    def ring_idx(r, s):
        return 1 + (r - 1) * segments + (s % segments)

    for s in range(segments):                 # 北極の三角
        faces.append((0, ring_idx(1, s), ring_idx(1, s + 1)))
    for r in range(1, rings - 1):             # 中間の四角
        for s in range(segments):
            faces.append((ring_idx(r, s), ring_idx(r + 1, s),
                          ring_idx(r + 1, s + 1), ring_idx(r, s + 1)))
    for s in range(segments):                 # 南極の三角
        faces.append((south, ring_idx(rings - 1, s + 1), ring_idx(rings - 1, s)))

    me.clear_geometry()
    me.from_pydata(verts, [], faces)
    for p in me.polygons:
        p.use_smooth = True
    me.update()
    return me


# ---------------------------------------------------------------------------
# マテリアル
# ---------------------------------------------------------------------------
def make_block_material():
    """電気的コバルトブルーの半光沢。is_red 属性で選択ノードを赤く発光させる。"""
    name = PREFIX + "Mat_Block"
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (600, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled"); bsdf.location = (300, 0)

    # インスタンサから is_red を読む
    attr = nt.nodes.new("ShaderNodeAttribute"); attr.location = (-400, -200)
    attr.attribute_type = "INSTANCER"
    attr.attribute_name = "is_red"

    cobalt = (0.02, 0.09, 0.55, 1.0)   # 電気的コバルトブルー
    red = (0.75, 0.02, 0.04, 1.0)      # 選択ノードの赤

    # base color = mix(cobalt, red, is_red)
    mix = _make_mix_rgb(nt); mix.location = (-100, 0)
    set_socket_default(mix, "Fac", 0.0)
    _mix_set_colors(mix, cobalt, red)
    nt.links.new(attr.outputs["Fac"], _mix_fac_socket(mix))

    nt.links.new(_mix_out_socket(mix), bsdf.inputs["Base Color"])
    set_principled(bsdf, ["Roughness"], 0.35)          # 半光沢
    set_principled(bsdf, ["Metallic"], 0.0)
    set_principled(bsdf, ["Specular IOR Level", "Specular"], 0.5)

    # 発光: 通常はごく弱く、赤ノードは強めに光らせる
    set_principled(bsdf, ["Emission Color", "Emission"], cobalt)
    emit_mix = _make_mix_rgb(nt); emit_mix.location = (-100, -220)
    _mix_set_colors(emit_mix, cobalt, red)
    nt.links.new(attr.outputs["Fac"], _mix_fac_socket(emit_mix))
    nt.links.new(_mix_out_socket(emit_mix),
                 bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission"))
    # 発光強度 = 0.15 + is_red * 2.5
    m_mul = nt.nodes.new("ShaderNodeMath"); m_mul.operation = "MULTIPLY"; m_mul.location = (-100, -420)
    m_mul.inputs[1].default_value = 2.5
    nt.links.new(attr.outputs["Fac"], m_mul.inputs[0])
    m_add = nt.nodes.new("ShaderNodeMath"); m_add.operation = "ADD"; m_add.location = (100, -420)
    m_add.inputs[1].default_value = 0.15
    nt.links.new(m_mul.outputs[0], m_add.inputs[0])
    es = bsdf.inputs.get("Emission Strength")
    if es is not None:
        nt.links.new(m_add.outputs[0], es)

    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def _make_mix_rgb(nt):
    """バージョン差異を吸収した色ミックスノード。"""
    try:
        n = nt.nodes.new("ShaderNodeMixRGB")
        n["_kind"] = "legacy"
        return n
    except Exception:
        n = nt.nodes.new("ShaderNodeMix")
        n.data_type = "RGBA"
        n["_kind"] = "new"
        return n


def _mix_fac_socket(n):
    if n.get("_kind") == "new":
        return n.inputs[0]          # Factor(float)
    return n.inputs["Fac"]


def _mix_set_colors(n, a, b):
    if n.get("_kind") == "new":
        n.inputs[6].default_value = a   # A (color)
        n.inputs[7].default_value = b   # B (color)
    else:
        n.inputs["Color1"].default_value = a
        n.inputs["Color2"].default_value = b


def _mix_out_socket(n):
    if n.get("_kind") == "new":
        return n.outputs[2]         # Result (color)
    return n.outputs["Color"]


def make_emissive_material():
    """白〜淡いライラックの発光マテリアル。"""
    name = PREFIX + "Mat_Emissive"
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (300, 0)
    emit = nt.nodes.new("ShaderNodeEmission"); emit.location = (0, 0)
    emit.inputs["Color"].default_value = (0.88, 0.83, 1.0, 1.0)  # 淡いライラック
    emit.inputs["Strength"].default_value = 3.0
    nt.links.new(emit.outputs["Emission"], out.inputs["Surface"])
    return mat


# ---------------------------------------------------------------------------
# Geometry Nodes 構築
# ---------------------------------------------------------------------------
def build_geometry_nodes(src_cube_obj, cfg):
    name = PREFIX + "GN_Field"
    ng = bpy.data.node_groups.get(name)
    if ng is None:
        ng = bpy.data.node_groups.new(name, "GeometryNodeTree")
    ng.nodes.clear()

    # インターフェース (modifier 用に Geometry 入出力)
    if hasattr(ng, "interface"):
        ng.interface.clear()
    ng_new_socket(ng, "Geometry", "INPUT", "NodeSocketGeometry")
    ng_new_socket(ng, "Geometry", "OUTPUT", "NodeSocketGeometry")

    nodes, links = ng.nodes, ng.links

    def N(idn, loc):
        n = nodes.new(idn); n.location = loc
        return n

    grid_x, grid_y = cfg["grid_x"], cfg["grid_y"]
    spacing = cfg["spacing"]
    size_x = spacing * (grid_x - 1)
    size_y = spacing * (grid_y - 1)
    max_radius = max(0.001, 0.5 * math.sqrt(size_x ** 2 + size_y ** 2))
    block_xy = spacing * 0.82
    build_start = float(cfg["build_start_frame"])
    build_end = float(cfg["build_end_frame"])
    feather = max(2.0, (build_end - build_start) * 0.25)
    span = max(0.001, (build_end - build_start - feather))
    rand_h = (cfg["max_height"] - cfg["min_height"]) * 0.35
    seed = cfg["random_seed"]

    g_in = N("NodeGroupInput", (-1400, 400))
    g_out = N("NodeGroupOutput", (1600, 0))

    # --- グリッド -> 点 ---
    grid = N("GeometryNodeMeshGrid", (-1200, 200))
    set_socket_default(grid, "Size X", size_x)
    set_socket_default(grid, "Size Y", size_y)
    set_socket_default(grid, "Vertices X", grid_x)
    set_socket_default(grid, "Vertices Y", grid_y)
    m2p = N("GeometryNodeMeshToPoints", (-1000, 200))
    links.new(grid.outputs["Mesh"], m2p.inputs["Mesh"])

    # --- ソース Cube ---
    objinfo = N("GeometryNodeObjectInfo", (-1000, -200))
    try:
        objinfo.transform_space = "ORIGINAL"
    except Exception:
        pass
    set_socket_default(objinfo, "Object", src_cube_obj)

    pos = N("GeometryNodeInputPosition", (-1200, -450))
    idx = N("GeometryNodeInputIndex", (-1200, -600))

    # seed によるノイズ位置オフセット (seed を変えると山の配置が変わる)
    seed_vec = N("ShaderNodeCombineXYZ", (-1000, -450))
    seed_vec.inputs[0].default_value = (seed % 97) * 0.137
    seed_vec.inputs[1].default_value = (seed % 89) * 0.911
    seed_vec.inputs[2].default_value = 0.0
    pos_seed = N("ShaderNodeVectorMath", (-800, -450)); pos_seed.operation = "ADD"
    links.new(pos.outputs["Position"], pos_seed.inputs[0])
    links.new(seed_vec.outputs["Vector"], pos_seed.inputs[1])

    # --- 高さフィールド ---
    noise1 = N("ShaderNodeTexNoise", (-600, 100))
    set_socket_default(noise1, "Scale", cfg["noise_scale"])
    links.new(pos_seed.outputs["Vector"], noise1.inputs["Vector"])
    noise_term = N("ShaderNodeMath", (-380, 100)); noise_term.operation = "MULTIPLY"
    noise_term.inputs[1].default_value = cfg["noise_strength"]
    links.new(noise1.outputs["Fac"], noise_term.inputs[0])

    rand = N("FunctionNodeRandomValue", (-600, -120))
    try:
        rand.data_type = "FLOAT"
    except Exception:
        pass
    set_socket_default(rand, "Min", 0.0)
    set_socket_default(rand, "Max", rand_h)
    set_socket_default(rand, "Seed", seed)
    _link_id(links, idx, rand)

    # 中心からの距離 -> 半径フォールオフ
    dist = N("ShaderNodeVectorMath", (-600, -320)); dist.operation = "LENGTH"
    links.new(pos.outputs["Position"], dist.inputs[0])
    radial = N("ShaderNodeMapRange", (-380, -320))
    radial.interpolation_type = "SMOOTHSTEP"
    links.new(dist.outputs["Value"], radial.inputs["Value"])
    set_socket_default(radial, "From Min", 0.0)
    set_socket_default(radial, "From Max", max_radius)
    set_socket_default(radial, "To Min", 1.0)
    set_socket_default(radial, "To Max", 0.0)

    # 低周波ノイズ x 半径フォールオフ = 中央の複数の山
    noise2 = N("ShaderNodeTexNoise", (-600, -520))
    set_socket_default(noise2, "Scale", max(0.05, cfg["noise_scale"] * 0.5))
    links.new(pos_seed.outputs["Vector"], noise2.inputs["Vector"])
    pk1 = N("ShaderNodeMath", (-180, -420)); pk1.operation = "MULTIPLY"
    links.new(noise2.outputs["Fac"], pk1.inputs[0])
    links.new(radial.outputs["Result"], pk1.inputs[1])
    peaks = N("ShaderNodeMath", (20, -420)); peaks.operation = "MULTIPLY"
    peaks.inputs[1].default_value = cfg["center_peak_strength"]
    links.new(pk1.outputs[0], peaks.inputs[0])

    sA = N("ShaderNodeMath", (-160, 100)); sA.operation = "ADD"
    links.new(noise_term.outputs[0], sA.inputs[0])
    links.new(first_enabled_output(rand), sA.inputs[1])
    sB = N("ShaderNodeMath", (40, 100)); sB.operation = "ADD"
    links.new(sA.outputs[0], sB.inputs[0])
    links.new(peaks.outputs[0], sB.inputs[1])
    sC = N("ShaderNodeMath", (240, 100)); sC.operation = "ADD"
    sC.inputs[1].default_value = cfg["min_height"]
    links.new(sB.outputs[0], sC.inputs[0])

    height = N("ShaderNodeClamp", (440, 100))
    links.new(sC.outputs[0], height.inputs["Value"])
    set_socket_default(height, "Min", cfg["min_height"])
    set_socket_default(height, "Max", cfg["max_height"])

    # --- 生成の波 (Scene Time から算出 / キーフレーム不要) ---
    stime = N("GeometryNodeInputSceneTime", (-380, 480))
    norm = N("ShaderNodeMath", (-160, -600)); norm.operation = "DIVIDE"
    norm.inputs[1].default_value = max_radius
    links.new(dist.outputs["Value"], norm.inputs[0])
    t1 = N("ShaderNodeMath", (40, -600)); t1.operation = "MULTIPLY"
    t1.inputs[1].default_value = span
    links.new(norm.outputs[0], t1.inputs[0])
    pstart = N("ShaderNodeMath", (240, -600)); pstart.operation = "ADD"
    pstart.inputs[1].default_value = build_start
    links.new(t1.outputs[0], pstart.inputs[0])
    pend = N("ShaderNodeMath", (440, -600)); pend.operation = "ADD"
    pend.inputs[1].default_value = feather
    links.new(pstart.outputs[0], pend.inputs[0])

    progress = N("ShaderNodeMapRange", (640, -400))
    progress.interpolation_type = "SMOOTHERSTEP"
    links.new(stime.outputs["Frame"], progress.inputs["Value"])
    links.new(pstart.outputs[0], progress.inputs["From Min"])
    links.new(pend.outputs[0], progress.inputs["From Max"])
    set_socket_default(progress, "To Min", 0.0)
    set_socket_default(progress, "To Max", 1.0)

    # Z スケール = 高さ x 波の進捗 (0 -> 最終値)
    zscale = N("ShaderNodeMath", (840, 0)); zscale.operation = "MULTIPLY"
    links.new(height.outputs[0], zscale.inputs[0])
    links.new(progress.outputs["Result"], zscale.inputs[1])
    scale_vec = N("ShaderNodeCombineXYZ", (1040, 0))
    scale_vec.inputs[0].default_value = block_xy
    scale_vec.inputs[1].default_value = block_xy
    links.new(zscale.outputs[0], scale_vec.inputs[2])

    # --- インスタンス化 (Realize しない) ---
    iop = N("GeometryNodeInstanceOnPoints", (1240, 100))
    links.new(m2p.outputs["Points"], iop.inputs["Points"])
    links.new(objinfo.outputs["Geometry"], iop.inputs["Instance"])
    links.new(scale_vec.outputs["Vector"], iop.inputs["Scale"])

    # --- is_red 属性 (Seed 固定 = 毎回同じ位置) ---
    rand_b = N("FunctionNodeRandomValue", (1040, -300))
    try:
        rand_b.data_type = "BOOLEAN"
    except Exception:
        pass
    set_socket_default(rand_b, "Probability", cfg["red_ratio"])
    set_socket_default(rand_b, "Seed", seed + 7777)
    _link_id(links, idx, rand_b)
    store = N("GeometryNodeStoreNamedAttribute", (1420, 100))
    try:
        store.data_type = "BOOLEAN"
        store.domain = "INSTANCE"
    except Exception:
        pass
    set_socket_default(store, "Name", "is_red")
    links.new(iop.outputs["Instances"], store.inputs["Geometry"])
    links.new(first_enabled_output(rand_b), store.inputs["Value"])

    links.new(store.outputs["Geometry"], g_out.inputs["Geometry"])
    return ng, grid_x * grid_y


def _link_id(links, index_node, rand_node):
    """RandomValue の ID 入力に Index を接続 (存在時のみ)。"""
    id_sock = None
    for s in rand_node.inputs:
        if s.name == "ID":
            id_sock = s
            break
    if id_sock is not None:
        links.new(index_node.outputs["Index"], id_sock)


# ---------------------------------------------------------------------------
# ライティング / ワールド
# ---------------------------------------------------------------------------
def build_lighting(coll):
    key_data = bpy.data.lights.new(PREFIX + "Key", "AREA")
    key_data.shape = "RECTANGLE"
    key_data.size = 30.0
    key_data.size_y = 18.0
    key_data.energy = 4000.0
    key_data.color = (1.0, 0.98, 0.94)
    key = bpy.data.objects.new(PREFIX + "Key", key_data)
    key.location = (18.0, -22.0, 34.0)
    key.rotation_euler = (math.radians(48), 0.0, math.radians(38))
    coll.objects.link(key)

    fill_data = bpy.data.lights.new(PREFIX + "Fill", "AREA")
    fill_data.shape = "RECTANGLE"
    fill_data.size = 26.0
    fill_data.energy = 900.0
    fill_data.color = (0.9, 0.93, 1.0)
    fill = bpy.data.objects.new(PREFIX + "Fill", fill_data)
    fill.location = (-24.0, -6.0, 20.0)
    fill.rotation_euler = (math.radians(62), 0.0, math.radians(-52))
    coll.objects.link(fill)

    # ワールド (淡いアイボリー)
    world = bpy.data.worlds.get(PREFIX + "World")
    if world is None:
        world = bpy.data.worlds.new(PREFIX + "World")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs["Color"].default_value = (0.93, 0.90, 0.82, 1.0)
        bg.inputs["Strength"].default_value = 0.35
    bpy.context.scene.world = world
    return [key, fill]


# ---------------------------------------------------------------------------
# カメラ
# ---------------------------------------------------------------------------
def _look_euler(loc, target):
    d = Vector(target) - Vector(loc)
    return d.to_track_quat("-Z", "Y").to_euler()


def _key_loc(obj, frame, loc):
    obj.location = loc
    obj.keyframe_insert("location", frame=frame)


def _key_rot(obj, frame, euler):
    obj.rotation_euler = euler
    obj.keyframe_insert("rotation_euler", frame=frame)


def build_cameras(coll, cfg):
    grid_x, grid_y, spacing = cfg["grid_x"], cfg["grid_y"], cfg["spacing"]
    hx = spacing * (grid_x - 1) * 0.5
    hy = spacing * (grid_y - 1) * 0.5
    mh = cfg["max_height"]
    cams = {}

    def new_cam(key, lens):
        cd = bpy.data.cameras.new(PREFIX + "Cam" + key)
        cd.lens = lens
        cd.dof.aperture_fstop = 2.8
        obj = bpy.data.objects.new(PREFIX + "CAM_" + key, cd)
        coll.objects.link(obj)
        return obj, cd

    # --- CAM_06_EMERGENCE : 40mm, 低めの中距離, わずかにドリーイン ---
    c06, d06 = new_cam("06", 40.0)
    tgt06 = (0.0, 0.0, mh * 0.45)
    loc_a = (2.0, -hy - mh * 2.2, mh * 1.35)
    loc_b = (0.0, -hy * 0.9 - mh * 1.2, mh * 1.2)
    _key_loc(c06, SHOT_RANGES["06"][0], loc_a)
    _key_loc(c06, SHOT_RANGES["06"][1], loc_b)
    e06 = _look_euler(loc_b, tgt06)
    _key_rot(c06, SHOT_RANGES["06"][0], _look_euler(loc_a, tgt06))
    _key_rot(c06, SHOT_RANGES["06"][1], e06)
    d06.dof.focus_distance = (Vector(loc_b) - Vector(tgt06)).length
    cams["06"] = c06

    # --- CAM_07_DIVE : 24mm, 内部を高速移動 (衝突回避), 手前パララックス強 ---
    c07, d07 = new_cam("07", 24.0)
    loc_a = (hx * 0.15, -hy * 1.15, mh * 1.25)   # ブロック上端より高く保ち衝突回避
    loc_b = (-hx * 0.12, hy * 1.15, mh * 1.05)
    _key_loc(c07, SHOT_RANGES["07"][0], loc_a)
    _key_loc(c07, SHOT_RANGES["07"][1], loc_b)
    # 進行方向 (+Y, やや下向き) を固定 -> スピンせず滑らかなダイブ
    fwd = _look_euler((0, 0, 0), (0.0, 10.0, -1.6))
    _key_rot(c07, SHOT_RANGES["07"][0], fwd)
    _key_rot(c07, SHOT_RANGES["07"][1], fwd)
    d07.dof.focus_distance = mh * 3.0
    cams["07"] = c07

    # --- CAM_08_HERO : 50mm, 上昇しながら後退, 最終フレームがヒーロー構図 ---
    c08, d08 = new_cam("08", 50.0)
    tgt08 = (0.0, 0.0, mh * 0.5)
    loc_a = (hx * 0.5, -hy * 1.3, mh * 1.5)
    loc_b = (hx * 0.95, -hy * 2.5, mh * 3.3)
    _key_loc(c08, SHOT_RANGES["08"][0], loc_a)
    _key_loc(c08, SHOT_RANGES["08"][1], loc_b)
    _key_rot(c08, SHOT_RANGES["08"][0], _look_euler(loc_a, tgt08))
    _key_rot(c08, SHOT_RANGES["08"][1], _look_euler(loc_b, tgt08))
    d08.dof.focus_distance = (Vector(loc_b) - Vector(tgt08)).length
    cams["08"] = c08

    return cams


def setup_markers(cams):
    scene = bpy.context.scene
    for m in list(scene.timeline_markers):
        if m.name.startswith("SHOT_"):
            scene.timeline_markers.remove(m)
    for key in CAM_KEYS:
        mk = scene.timeline_markers.new("SHOT_" + key, frame=SHOT_MARKER_FRAME[key])
        mk.camera = cams[key]


# ---------------------------------------------------------------------------
# 発光球 (ヒーロー要素)
# ---------------------------------------------------------------------------
def build_hero_spheres(coll, emissive_mat, cfg):
    mh = cfg["max_height"]
    positions = [
        (0.0, 0.0, mh * 1.15),
        (cfg["spacing"] * 3.0, -cfg["spacing"] * 2.0, mh * 0.95),
        (-cfg["spacing"] * 2.5, cfg["spacing"] * 3.0, mh * 1.05),
    ]
    objs = []
    for i in range(min(HERO_SPHERE_COUNT, len(positions))):
        me = make_uv_sphere_mesh(PREFIX + "HeroSphere_%d" % i, radius=cfg["spacing"] * 0.6)
        if me.materials:
            me.materials.clear()
        me.materials.append(emissive_mat)
        obj = bpy.data.objects.new(PREFIX + "HeroSphere_%d" % i, me)
        obj.location = positions[i]
        coll.objects.link(obj)
        objs.append(obj)
    return objs


# ---------------------------------------------------------------------------
# レンダー設定 (プレビュー / 最終の2段)
# ---------------------------------------------------------------------------
def apply_common_render(scene, cfg):
    scene.render.engine = eevee_engine()
    scene.render.fps = FPS
    scene.render.resolution_x = BASE_RES_X
    scene.render.resolution_y = BASE_RES_Y
    scene.render.film_transparent = True          # 背景透過
    scene.frame_start = FRAME_START
    scene.frame_end = FRAME_END
    scene.render.image_settings.color_mode = "RGBA"


def _set_motion_blur(scene, on):
    if hasattr(scene.render, "use_motion_blur"):
        scene.render.use_motion_blur = on
    if hasattr(scene, "eevee") and hasattr(scene.eevee, "use_motion_blur"):
        scene.eevee.use_motion_blur = on


def _set_dof(scene, on):
    for obj in scene.objects:
        if obj.type == "CAMERA" and obj.name.startswith(PREFIX):
            obj.data.dof.use_dof = on


def apply_preview_render(scene, cfg):
    apply_common_render(scene, cfg)
    scene.render.resolution_percentage = cfg["preview_resolution_percentage"]  # 50% = 960x540
    if hasattr(scene, "eevee"):
        try:
            scene.eevee.taa_render_samples = 16
        except Exception:
            pass
    _set_motion_blur(scene, False)   # プレビューは MB OFF
    _set_dof(scene, False)           # DOF OFF
    scene.render.image_settings.file_format = "PNG"


def apply_final_render(scene, cfg):
    apply_common_render(scene, cfg)
    scene.render.resolution_percentage = cfg["final_resolution_percentage"]     # 100% = 1920x1080
    if hasattr(scene, "eevee"):
        try:
            scene.eevee.taa_render_samples = 64
        except Exception:
            pass
    _set_motion_blur(scene, True)    # 最終のみ MB ON
    _set_dof(scene, True)            # 最終のみ DOF ON
    scene.render.image_settings.file_format = cfg["output_format"]
    if cfg["output_format"] == "OPEN_EXR":
        try:
            scene.render.image_settings.color_depth = "16"
            scene.render.image_settings.exr_codec = "ZIP"
        except Exception:
            pass


# ---------------------------------------------------------------------------
# レンダリング実行
# ---------------------------------------------------------------------------
def render_preview_stills(scene, cams, preview_dir, cfg):
    apply_preview_render(scene, cfg)
    os.makedirs(preview_dir, exist_ok=True)
    names = {"06": "preview_06_emergence", "07": "preview_07_dive", "08": "preview_08_hero"}
    for key in CAM_KEYS:
        scene.camera = cams[key]
        scene.frame_set(REP_FRAME[key])
        scene.render.filepath = os.path.join(preview_dir, names[key] + ".png")
        try:
            bpy.ops.render.render(write_still=True)
            log("プレビュー静止画を保存: %s.png (CAM_%s)" % (names[key], key))
        except Exception as e:
            log("プレビュー描画に失敗 (CAM_%s): %s" % (key, e), "WARN")
            log("  ※ EEVEE のヘッドレス描画には GPU が必要です。GUI から実行してください。", "WARN")


def render_final_shot(scene, shot_key, render_dir, cfg):
    apply_final_render(scene, cfg)
    start, end = SHOT_RANGES[shot_key]
    scene.frame_start, scene.frame_end = start, end
    shot_dir = os.path.join(render_dir, "shot_%s" % shot_key)
    os.makedirs(shot_dir, exist_ok=True)
    scene.render.filepath = os.path.join(shot_dir, "shot_%s_" % shot_key)
    # camera はマーカーで自動切替される
    try:
        bpy.ops.render.render(animation=True)
        log("最終レンダー完了: shot_%s (frames %d-%d) -> %s" % (shot_key, start, end, shot_dir))
    except Exception as e:
        log("最終レンダーに失敗 (shot_%s): %s" % (shot_key, e), "ERROR")


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------
def build(cfg, output_dir):
    scene = bpy.context.scene

    # 1) バックアップ (コピーのみ)
    os.makedirs(output_dir, exist_ok=True)
    make_backup(output_dir)

    # 2) 前回生成物の安全な破棄 -> 専用コレクション再生成
    purge_previous()
    coll = get_world_collection()

    # 3) マテリアル
    block_mat = make_block_material()
    emissive_mat = make_emissive_material()

    # 4) ソース Cube (1個だけ / ベベルは modifier で最小限)
    src_me = make_rounded_cube_mesh()
    if src_me.materials:
        src_me.materials.clear()
    src_me.materials.append(block_mat)
    src = bpy.data.objects.new(PREFIX + "SrcCube", src_me)
    coll.objects.link(src)
    bev = src.modifiers.new("Bevel", "BEVEL")
    bev.width = 0.05
    bev.segments = 2
    try:
        bev.limit_method = "ANGLE"
    except Exception:
        pass
    src.hide_render = True   # ソースは描画しない (Object Info からのみ参照)

    # 5) Geometry Nodes フィールド
    field_me = bpy.data.meshes.get(PREFIX + "Field") or bpy.data.meshes.new(PREFIX + "Field")
    field_me.clear_geometry()
    field = bpy.data.objects.new(PREFIX + "Field", field_me)
    coll.objects.link(field)
    ng, instance_count = build_geometry_nodes(src, cfg)
    mod = field.modifiers.new("OutputField", "NODES")
    mod.node_group = ng

    # 6) ライト / ワールド / カメラ / マーカー / 発光球
    lights = build_lighting(coll)
    cams = build_cameras(coll, cfg)
    setup_markers(cams)
    spheres = build_hero_spheres(coll, emissive_mat, cfg)

    # 7) シーン共通設定
    apply_common_render(scene, cfg)
    scene.camera = cams["06"]

    return {
        "collection": coll, "cams": cams, "instance_count": instance_count,
        "object_count": len(coll.objects), "lights": lights, "spheres": spheres,
    }


def save_blend(output_dir):
    path = os.path.join(output_dir, "output_world.blend")
    try:
        bpy.ops.wm.save_as_mainfile(filepath=path)
        log(".blend を保存しました: %s" % path)
    except Exception as e:
        log(".blend 保存に失敗: %s" % e, "ERROR")
    return path


def print_summary(info, cfg, output_dir, rendered):
    scene = bpy.context.scene
    log("=" * 60)
    log("  OUTPUT WORLD  ビルド完了サマリ")
    log("-" * 60)
    log("  Blender バージョン    : %s" % (bpy.app.version_string,))
    log("  オブジェクト数        : %d (コレクション %s)" % (info["object_count"], COLL_NAME))
    log("  インスタンス数        : %d (= %dx%d)" %
        (info["instance_count"], cfg["grid_x"], cfg["grid_y"]))
    log("  カメラ                : %s" % ", ".join(PREFIX + "CAM_" + k for k in CAM_KEYS))
    log("  レンダーエンジン      : %s" % scene.render.engine)
    log("  解像度                : %dx%d @ %d%%" %
        (scene.render.resolution_x, scene.render.resolution_y,
         scene.render.resolution_percentage))
    log("  fps / フレーム範囲    : %d fps / %d-%d" % (FPS, FRAME_START, FRAME_END))
    log("  背景透過              : %s" % scene.render.film_transparent)
    log("  出力フォーマット      : %s" % cfg["output_format"])
    log("  乱数 Seed             : %d (赤ノード位置は固定)" % cfg["random_seed"])
    log("  保存先 .blend         : %s" % os.path.join(output_dir, "output_world.blend"))
    log("  プレビュー保存先      : %s" % os.path.join(output_dir, "previews"))
    log("  最終レンダー保存先    : %s" % os.path.join(output_dir, "render"))
    log("  プレビュー描画        : %s" % ("実行済み" if rendered else "スキップ"))
    log("=" * 60)


def main():
    opts = parse_args()
    base = script_dir()
    cfg_path = opts["config"] or os.path.join(base, "config.json")
    output_dir = os.path.join(base, "output")
    preview_dir = os.path.join(output_dir, "previews")
    render_dir = os.path.join(output_dir, "render")

    log("OUTPUT WORLD ビルドを開始します。")
    log("Blender %s / Python %s" % (bpy.app.version_string, sys.version.split()[0]))

    cfg = load_config(cfg_path)

    try:
        info = build(cfg, output_dir)
    except Exception as e:
        log("ビルド中にエラーが発生しました: %s" % e, "ERROR")
        log(traceback.format_exc(), "ERROR")
        raise

    save_blend(output_dir)

    rendered = False
    scene = bpy.context.scene
    if opts["render"]:
        if opts["final"]:
            shots = CAM_KEYS if not opts["shot"] or opts["shot"] == "all" else (opts["shot"],)
            os.makedirs(render_dir, exist_ok=True)
            for s in shots:
                if s in SHOT_RANGES:
                    render_final_shot(scene, s, render_dir, cfg)
            rendered = True
        else:
            render_preview_stills(scene, info["cams"], preview_dir, cfg)
            rendered = True
        # レンダー後にプレビュー設定へ戻し、blend を再保存
        apply_preview_render(scene, cfg)
        scene.frame_start, scene.frame_end = FRAME_START, FRAME_END
        save_blend(output_dir)

    print_summary(info, cfg, output_dir, rendered)
    log("完了しました。")


if __name__ == "__main__":
    main()
