# SPDX-License-Identifier: Apache-2.0
"""Make the Rigify mannequin of the characters sample. Own work, CC0.

The script makes a small humanoid from nothing with Blender 5.2 and the Rigify add-on of Blender:

1. Add the "Basic Human" metarig of Rigify and generate the rig.
2. Make a mannequin body from tapered cylinders and spheres. Each part has the weight 1 on one deform bone (DEF-*).
3. Give the deform bones a clean hierarchy (the thighs under DEF-spine, the shoulders under DEF-spine.003). The
   constraints of Rigify set the pose of the deform bones in world space, so the pose does not change.
4. Key a procedural idle of 3 s on the controls of the rig: the arms down (FK), the breath, a small sway, the head.
5. Export a GLB with the deform bones only and the clip "Idle".

Run from the repo root:
    blender -b --factory-startup --python samples/characters/tools/make_rigify_mannequin.py -- --out <glb>
"""

import argparse
import math
import sys

import addon_utils
import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

FPS = 30
SECONDS = 3
FRAMES = FPS * SECONDS

# The parts of the body: the deform bone, the radius at the head and at the tail of the bone (metres).
SEGMENTS = [
    ("DEF-spine", 0.115, 0.12),
    ("DEF-spine.001", 0.115, 0.12),
    ("DEF-spine.002", 0.12, 0.135),
    ("DEF-spine.003", 0.135, 0.07),
    ("DEF-spine.004", 0.045, 0.042),
    ("DEF-spine.005", 0.042, 0.04),
    ("DEF-shoulder.L", 0.04, 0.045),
    ("DEF-upper_arm.L", 0.048, 0.044),
    ("DEF-upper_arm.L.001", 0.044, 0.038),
    ("DEF-forearm.L", 0.037, 0.033),
    ("DEF-forearm.L.001", 0.033, 0.027),
    ("DEF-hand.L", 0.03, 0.022),
    ("DEF-thigh.L", 0.078, 0.066),
    ("DEF-thigh.L.001", 0.066, 0.052),
    ("DEF-shin.L", 0.05, 0.043),
    ("DEF-shin.L.001", 0.043, 0.034),
    ("DEF-foot.L", 0.036, 0.03),
    ("DEF-toe.L", 0.028, 0.022),
]
# The spheres of the body: the deform bone, the place along the bone (0 head, 1 tail), the radii (x, y, z).
SPHERES = [
    ("DEF-spine.006", 0.45, (0.095, 0.11, 0.12)),
    ("DEF-upper_arm.L", 0.0, (0.05, 0.05, 0.05)),
    ("DEF-forearm.L", 0.0, (0.04, 0.04, 0.04)),
    ("DEF-hand.L", 0.0, (0.03, 0.03, 0.03)),
    ("DEF-shin.L", 0.0, (0.055, 0.055, 0.055)),
    ("DEF-foot.L", 0.0, (0.04, 0.04, 0.04)),
]
# The new parents of the deform bones whose parent is not a deform bone.
DEFORM_PARENTS = {
    "DEF-thigh": "DEF-spine",
    "DEF-pelvis": "DEF-spine",
    "DEF-shoulder": "DEF-spine.003",
    "DEF-upper_arm": "DEF-shoulder",
    "DEF-breast": "DEF-spine.003",
}


def fail(message):
    print(f"make_rigify_mannequin: {message}", file=sys.stderr)
    sys.exit(1)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    return parser.parse_args(argv)


def mirrored(items):
    """The items of the left side and the same items of the right side (".L" becomes ".R")."""
    out = []
    for item in items:
        out.append(item)
        if ".L" in item[0]:
            out.append((item[0].replace(".L", ".R"), *item[1:]))
    return out


def make_rig():
    addon_utils.enable("rigify", default_set=True)
    bpy.ops.object.armature_basic_human_metarig_add()
    metarig = bpy.context.active_object
    bpy.ops.pose.rigify_generate()
    rig = bpy.context.active_object
    if rig is metarig or rig.type != "ARMATURE":
        fail("Rigify did not generate a rig")
    bpy.data.objects.remove(metarig)
    for name in [c.name for c in bpy.data.collections if c.name.startswith("WGTS")]:
        collection = bpy.data.collections[name]
        for ob in list(collection.objects):
            bpy.data.objects.remove(ob)
        bpy.data.collections.remove(collection)
    return rig


def clean_deform_hierarchy(rig):
    """Parent each deform bone to a deform bone, and keep the world pose of each bone (a test pose checks it)."""
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    bones = rig.data.edit_bones
    for bone in bones:
        if not bone.name.startswith("DEF-") or (bone.parent is not None and bone.parent.name.startswith("DEF-")):
            continue
        stem = bone.name.rsplit(".", 1)[0] if bone.name.endswith((".L", ".R")) else bone.name
        side = bone.name[-2:] if bone.name.endswith((".L", ".R")) else ""
        parent = DEFORM_PARENTS.get(stem)
        if parent is None:
            continue
        target = bones.get(parent + side) or bones.get(parent)
        if target is None:
            fail(f"no bone {parent} for {bone.name}")
        bone.use_connect = False
        bone.parent = target
    bpy.ops.object.mode_set(mode="OBJECT")


def tapered(bm, head, tail, r_head, r_tail, sides=10):
    """Add a closed cylinder from `head` to `tail` with a radius at each end. Returns the new vertices."""
    axis = tail - head
    rot = axis.to_track_quat("Z", "Y")
    verts = []
    for z, radius in ((0.0, r_head), (1.0, r_tail)):
        ring = []
        for i in range(sides):
            angle = 2.0 * math.pi * i / sides
            local = Vector((math.cos(angle) * radius, math.sin(angle) * radius, 0.0))
            ring.append(bm.verts.new(head + axis * z + rot @ local))
        verts.append(ring)
    for i in range(sides):
        j = (i + 1) % sides
        bm.faces.new((verts[0][i], verts[0][j], verts[1][j], verts[1][i]))
    bm.faces.new(list(reversed(verts[0])))
    bm.faces.new(verts[1])
    return verts[0] + verts[1]


def ellipsoid(bm, centre, radii):
    """Add an ellipsoid at `centre`. Returns the new vertices."""
    result = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
    verts = result["verts"]
    for v in verts:
        v.co = centre + Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2]))
    return verts


def make_body(rig):
    mesh = bpy.data.meshes.new("mannequin")
    body = bpy.data.objects.new("mannequin", mesh)
    bpy.context.scene.collection.objects.link(body)
    bm = bmesh.new()
    parts = []
    bones = rig.data.bones
    for name, r_head, r_tail in mirrored(SEGMENTS):
        bone = bones[name]
        parts.append((name, tapered(bm, bone.head_local.copy(), bone.tail_local.copy(), r_head, r_tail)))
    for name, at, radii in mirrored(SPHERES):
        bone = bones[name]
        centre = bone.head_local.lerp(bone.tail_local, at)
        parts.append((name, ellipsoid(bm, centre, radii)))
    bm.verts.index_update()
    groups = [(name, [v.index for v in verts]) for name, verts in parts]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    for name, indices in groups:
        group = body.vertex_groups.get(name) or body.vertex_groups.new(name=name)
        group.add(indices, 1.0, "REPLACE")
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    material = bpy.data.materials.new("mannequin_wood")
    shader = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = (0.62, 0.45, 0.3, 1.0)
    shader.inputs["Roughness"].default_value = 0.7
    mesh.materials.append(material)
    body.parent = rig
    modifier = body.modifiers.new("Armature", "ARMATURE")
    modifier.object = rig
    return body


def set_world(rig, name, turn=None, offset=None):
    """Pose the control `name`: a world turn after its rest rotation, and a world offset of its head.

    The head follows the posed parent; the rotation does not (it is a world rotation from the rest pose).
    """
    bone = rig.pose.bones[name]
    rest = bone.bone.matrix_local
    head = rest.to_translation()
    if bone.parent is not None:
        relative = bone.parent.bone.matrix_local.inverted() @ rest
        head = (bone.parent.matrix @ relative).to_translation()
    if offset is not None:
        head = head + offset
    rotation = (turn if turn is not None else Quaternion()).to_matrix() @ rest.to_3x3()
    bone.matrix = Matrix.Translation(head) @ rotation.to_4x4()
    bpy.context.view_layer.update()


def toward(rig, name, direction):
    """The world turn that points the rest direction of the control `name` to `direction`."""
    bone = rig.pose.bones[name]
    rest_dir = (bone.bone.tail_local - bone.bone.head_local).normalized()
    return rest_dir.rotation_difference(direction.normalized())


def key_idle(rig):
    scene = bpy.context.scene
    scene.render.fps = FPS
    scene.frame_start = 0
    scene.frame_end = FRAMES
    for side in ("L", "R"):
        rig.pose.bones[f"upper_arm_parent.{side}"]["IK_FK"] = 1.0
    rig.animation_data_create()
    rig.animation_data.action = bpy.data.actions.new("Idle")
    controls = ["torso", "chest", "neck", "head"]
    for side in ("L", "R"):
        controls += [f"upper_arm_fk.{side}", f"forearm_fk.{side}", f"hand_fk.{side}"]
    for bone in rig.pose.bones:
        bone.rotation_mode = "QUATERNION" if bone.name in controls else bone.rotation_mode
    for frame in range(FRAMES + 1):
        scene.frame_set(frame)
        phase = 2.0 * math.pi * frame / FRAMES
        breath = math.sin(2.0 * phase)
        sway = math.sin(phase)
        set_world(rig, "torso", Quaternion((0, 1, 0), 0.015 * sway), Vector((0.012 * sway, 0, -0.006 + 0.004 * breath)))
        set_world(rig, "chest", Quaternion((1, 0, 0), -0.025 * breath))
        set_world(rig, "neck", Quaternion((1, 0, 0), 0.02 * breath))
        set_world(rig, "head", Quaternion((0, 0, 1), 0.12 * math.sin(phase + 0.6)))
        for side, sign in (("L", 1.0), ("R", -1.0)):
            arm = Vector((0.16 * sign, -0.04, -1.0))
            swing = Quaternion((1, 0, 0), 0.05 * math.sin(phase + (0 if sign > 0 else math.pi)))
            set_world(rig, f"upper_arm_fk.{side}", swing @ toward(rig, f"upper_arm_fk.{side}", arm))
            bend = Quaternion((1, 0, 0), -0.22 - 0.03 * breath)
            set_world(rig, f"forearm_fk.{side}", bend @ swing @ toward(rig, f"forearm_fk.{side}", arm))
            set_world(rig, f"hand_fk.{side}", bend @ swing @ toward(rig, f"hand_fk.{side}", arm))
        for name in controls:
            bone = rig.pose.bones[name]
            bone.keyframe_insert("rotation_quaternion", frame=frame)
            if name == "torso":
                bone.keyframe_insert("location", frame=frame)
    scene.frame_set(0)


def export(rig, body, out):
    bpy.ops.object.select_all(action="DESELECT")
    rig.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_def_bones=True,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_step=2,
        export_anim_slide_to_zero=True,
        export_rest_position_armature=True,
        export_morph=False,
        export_materials="EXPORT",
        export_extras=False,
        export_copyright="CC0-1.0 (own work of Scenity)",
    )


def main():
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rig = make_rig()
    clean_deform_hierarchy(rig)
    body = make_body(rig)
    key_idle(rig)
    export(rig, body, args.out)
    print(f"make_rigify_mannequin: wrote {args.out}")


main()
