# SPDX-License-Identifier: Apache-2.0
"""Export one Blender master as a glTF binary file.

Run it in the pinned toolchain (packages/assets/src/blender/run.ts calls it):

    blender -b --factory-startup -noaudio <master>.blend --python packages/assets/blender/export.py -- \
        --asset <id> --kind <model|skinned-model|animation> --out <path>.glb

The script exports the objects of the collection "export" only. The settings are fixed, so the same master
always gives the same bytes (checkExports of run.ts compares two runs):

- Y up, metres, no cameras, no lights, no extras, no custom properties, no copyright text.
- Skins with at most 4 influences for each vertex, all bones of the armature, the rest position.
- Morph targets (shape keys) without morph normals and tangents.
- Images go into the file as their original PNG or JPEG bytes. Blender does not encode them again.
- A model or a skinned model has no animation. An animation (a clip) has the armature and its actions, and no mesh.
  A static model has meshes only (no skin, no animation); the export does not check that.
- KHR_materials_variants: the material variants of the master (for example skin categories).

The export does not apply modifiers, because that removes the shape keys. A mesh can have only an Armature
modifier. The script stops with an error for another modifier: apply it in the master.
"""

import argparse
import os
import sys

import bpy

KINDS = ("model", "skinned-model", "animation")


def fail(message):
    print(f"export: {message}", file=sys.stderr)
    sys.exit(1)


def objects_of(collection):
    found = list(collection.objects)
    for child in collection.children:
        found.extend(objects_of(child))
    return found


def resolve_container_paths():
    """The toolchain image saves a master with the paths of its container (/work is the repo root). On another machine
    the export opens such an image from the same file of this checkout, so the export has its pixels."""
    root = os.getcwd()
    for image in bpy.data.images:
        path = bpy.path.abspath(image.filepath)
        if image.source == "FILE" and path.startswith("/work/") and not os.path.exists(path):
            image.filepath = os.path.join(root, path[len("/work/"):])
            image.reload()


def check_modifiers(objects):
    for obj in objects:
        if obj.type != "MESH":
            continue
        for modifier in obj.modifiers:
            if modifier.type != "ARMATURE":
                fail(f"{obj.name}: modifier {modifier.name} ({modifier.type}). Apply it in the master.")


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Export one master as GLB.")
    parser.add_argument("--asset", required=True)
    parser.add_argument("--kind", required=True, choices=KINDS)
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    collection = bpy.data.collections.get("export")
    if collection is None:
        fail(f"{args.asset}: the master has no collection named 'export'")
    objects = objects_of(collection)
    if args.kind == "animation":
        objects = [obj for obj in objects if obj.type == "ARMATURE"]
        if len(objects) != 1:
            fail(f"{args.asset}: a clip master needs one armature in 'export', found {len(objects)}")
        if objects[0].animation_data is None and not bpy.data.actions:
            fail(f"{args.asset}: the clip master has no action")
    else:
        check_modifiers(objects)
        if not any(obj.type == "MESH" for obj in objects):
            fail(f"{args.asset}: no mesh in 'export'")

    resolve_container_paths()

    # The variant properties exist only with this preference on (see the glTF add-on).
    bpy.context.preferences.addons["io_scene_gltf2"].preferences.KHR_materials_variants_ui = True

    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    for obj in objects:
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]

    clip = args.kind == "animation"
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    result = export(args.out, clip)
    if "FINISHED" not in result:
        fail(f"{args.asset}: the glTF export did not finish ({result})")
    print(f"export: wrote {args.out}")


def export(path, clip):
    """Call the glTF exporter with the fixed settings of this pipeline."""
    return bpy.ops.export_scene.gltf(
        filepath=path,
        check_existing=False,
        export_format="GLB",
        use_selection=True,
        use_visible=False,
        use_renderable=False,
        use_active_collection=False,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_keep_originals=False,
        export_unused_images=False,
        export_unused_textures=False,
        export_vertex_color="NONE",
        export_attributes=False,
        export_cameras=False,
        export_lights=False,
        export_extras=False,
        export_copyright="",
        export_shared_accessors=False,
        export_gpu_instances=False,
        export_skins=True,
        export_influence_nb=4,
        export_all_influences=False,
        export_def_bones=False,
        export_leaf_bone=False,
        export_hierarchy_flatten_bones=False,
        export_hierarchy_flatten_objs=False,
        export_armature_object_remove=False,
        export_rest_position_armature=True,
        export_reset_pose_bones=True,
        export_morph=not clip,
        export_morph_normal=False,
        export_morph_tangent=False,
        export_try_sparse_sk=False,
        export_animations=clip,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_step=1,
        export_optimize_animation_size=True,
        export_anim_slide_to_zero=True,
        export_bake_animation=False,
        export_morph_animation=False,
        will_save_settings=False,
    )


if __name__ == "__main__":
    main()
