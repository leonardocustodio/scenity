# SPDX-License-Identifier: Apache-2.0
"""Make the dropped-file fixtures of the import job tests.

The tests of packages/assets/src/blender/importDrop.ts run this script in Blender 5.2. It makes a small stool from
code (no file of another person, so no licence question) and writes it in four formats into the folder `--out`:

- `stool.fbx`: the stool in metres, with its color texture (a JPEG file, embedded), so the import converts it to PNG.
- `stool.glb`: the same stool as glTF with the JPEG image, so the import sends it through Blender (the build reads
  only PNG and KTX2 images).
- `stool.obj` (with `stool.mtl`): the stool in centimetres, so the import must find the unit from the size.
- `stool.blend`: the stool under a parent empty with a turn, a scale and an offset, and a Bevel modifier, so the import
  must apply the modifiers and the transforms and move the origin to the base.

Run: blender -b --factory-startup --python packages/assets/blender/tests/make_drop_fixtures.py -- --out <folder>
"""

import argparse
import math
import os
import sys

import bpy


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    return parser.parse_args(argv)


def checker(folder):
    """A 64 px checker texture, written as a JPEG file."""
    image = bpy.data.images.new("stool_color", 64, 64)
    pixels = []
    for y in range(64):
        for x in range(64):
            light = ((x // 8) + (y // 8)) % 2 == 0
            pixels.extend((0.8, 0.5, 0.2, 1.0) if light else (0.3, 0.2, 0.1, 1.0))
    image.pixels.foreach_set(pixels)
    path = os.path.join(folder, "stool_color.jpg")
    image.file_format = "JPEG"
    image.filepath_raw = path
    image.save()
    return bpy.data.images.load(path)


def material(image):
    mat = bpy.data.materials.new("stool_wood")
    tree = mat.node_tree
    bsdf = next(node for node in tree.nodes if node.type == "BSDF_PRINCIPLED")
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def stool(mat):
    """A seat on four legs: 0.4 m wide, 0.47 m high, the base on z = 0. Returns the objects."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.45))
    seat = bpy.context.active_object
    seat.name = "seat"
    seat.scale = (0.4, 0.4, 0.04)
    bpy.ops.object.transform_apply(scale=True)
    seat.data.materials.append(mat)
    parts = [seat]
    for index, (x, y) in enumerate(((0.16, 0.16), (-0.16, 0.16), (0.16, -0.16), (-0.16, -0.16))):
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.02, depth=0.43, location=(x, y, 0.215))
        leg = bpy.context.active_object
        leg.name = f"leg_{index}"
        leg.data.materials.append(mat)
        parts.append(leg)
    return parts


def select(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def main():
    out = os.path.abspath(parse_args().out)
    os.makedirs(out, exist_ok=True)
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    parts = stool(material(checker(out)))

    select(parts)
    bpy.ops.export_scene.fbx(
        filepath=os.path.join(out, "stool.fbx"), use_selection=True, path_mode="COPY", embed_textures=True
    )
    # The GLB file keeps the JPEG image, so the import must convert it through Blender to PNG.
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(out, "stool.glb"), export_format="GLB", use_selection=True, export_image_format="AUTO"
    )

    # The OBJ file in centimetres: scale the stool by 100 for the export, then restore the scale.
    for obj in parts:
        obj.scale = (100.0, 100.0, 100.0)
        obj.location = obj.location * 100.0
    bpy.ops.wm.obj_export(filepath=os.path.join(out, "stool.obj"), export_selected_objects=True, path_mode="COPY")
    for obj in parts:
        obj.scale = (1.0, 1.0, 1.0)
        obj.location = obj.location / 100.0

    # The .blend file: a parent with a turn, a scale and an offset, and a modifier that the import must apply.
    bpy.ops.object.empty_add(location=(2.0, -1.0, 0.5))
    parent = bpy.context.active_object
    parent.name = "stool_root"
    parent.rotation_euler = (0.0, 0.0, math.radians(30))
    parent.scale = (0.5, 0.5, 0.5)
    for obj in parts:
        obj.parent = parent
    bevel = parts[0].modifiers.new("bevel", "BEVEL")
    bevel.width = 0.005
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "stool.blend"), relative_remap=False)
    print(f"make_drop_fixtures: wrote the fixtures into {out}")


if __name__ == "__main__":
    main()
