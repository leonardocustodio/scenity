# SPDX-License-Identifier: Apache-2.0
"""Make the fixtures of the importer registry tests into packages/assets/tests/fixtures/import.

The script makes all fixtures from code (no file of another person, so no licence question), and each file is a few
KB. The tests read the committed files. Run the script again only to change a fixture.

- `box.gltf` (with `box.bin` and `box_color.png`), `box.glb` and `box.fbx`: a 0.5 m box and a 0.1 m lid on it, two
  meshes with one material and an 8 px PNG color texture. The base of the box is 1 m above the origin and 2 m to +X.
- `box.obj` (with `box.mtl`): the same meshes in centimetres, so the import finds the unit from the size.
- `tile.png`, `tile.jpg`, `tile.webp` and `tile.avif`: an image of 8 x 4 px. `sky.hdr`: a float image of 8 x 4 px.

Run (from the workspace root):
    blender -b --factory-startup --python packages/assets/blender/tests/make_import_fixtures.py
"""

import os

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "tests", "fixtures", "import"))


def clear():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def pixels(width, height, scale=1.0):
    data = []
    for y in range(height):
        for x in range(width):
            light = (x + y) % 2 == 0
            color = (0.8, 0.5, 0.2) if light else (0.2, 0.3, 0.6)
            data.extend((color[0] * scale, color[1] * scale, color[2] * scale, 1.0))
    return data


def save_image(name, file_format, width, height, float_buffer=False, scale=1.0):
    image = bpy.data.images.new(name, width, height, float_buffer=float_buffer)
    image.pixels.foreach_set(pixels(width, height, scale))
    extension = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp", "AVIF": "avif", "HDR": "hdr"}[file_format]
    path = os.path.join(OUT, f"{name}.{extension}")
    image.filepath_raw = path
    image.file_format = file_format
    image.save()
    return path


def material(color_path):
    mat = bpy.data.materials.new("box_paint")
    tree = mat.node_tree
    bsdf = next(node for node in tree.nodes if node.type == "BSDF_PRINCIPLED")
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(color_path)
    tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    return mat


def box(mat, unit=1.0):
    """The box and the lid: the base at z = 1 m, the centre at x = 2 m. Returns the objects."""
    made = []
    for name, size, z in (("box", 0.5, 1.25), ("lid", 0.1, 1.55)):
        bpy.ops.mesh.primitive_cube_add(size=size * unit, location=(2.0 * unit, 0.0, z * unit))
        obj = bpy.context.active_object
        obj.name = name
        obj.data.name = name
        bpy.ops.mesh.uv_texture_add()
        obj.data.materials.append(mat)
        made.append(obj)
    return made


def select(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def main():
    os.makedirs(OUT, exist_ok=True)
    clear()
    color = save_image("box_color", "PNG", 8, 8)
    mat = material(color)
    objects = box(mat)
    select(objects)
    common = {"use_selection": True, "export_yup": True, "export_apply": True, "export_extras": False}
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "box.glb"), export_format="GLB", **common)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(OUT, "box.gltf"), export_format="GLTF_SEPARATE", export_texture_dir="", **common
    )
    bpy.ops.export_scene.fbx(
        filepath=os.path.join(OUT, "box.fbx"), use_selection=True, path_mode="COPY", embed_textures=True
    )
    clear()
    select(box(mat, unit=100.0))
    bpy.ops.wm.obj_export(filepath=os.path.join(OUT, "box.obj"), export_selected_objects=True, path_mode="RELATIVE")
    for file_format in ("PNG", "JPEG", "WEBP", "AVIF"):
        save_image("tile", file_format, 8, 4)
    save_image("sky", "HDR", 8, 4, float_buffer=True, scale=4.0)
    print(f"make_import_fixtures: wrote {OUT}")


if __name__ == "__main__":
    main()
