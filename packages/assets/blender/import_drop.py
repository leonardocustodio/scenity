# SPDX-License-Identifier: Apache-2.0
"""Make a glTF binary file of a prop from a dropped file.

The import job of the workbench host (packages/assets/src/blender/importDrop.ts) runs this script for an FBX file, an
OBJ file, a Blender file, or a glTF file that the build cannot read as it is (JPEG or WebP textures, Draco). The
script:

1. Imports the FBX, OBJ or glTF file into an empty scene. Blender opens a .blend file before the script starts.
2. Makes the instanced collections real and converts each visible object to a mesh (the modifiers apply). It
   removes the other objects (empties, armatures, cameras, lights).
3. Applies the transforms: each mesh keeps its place in the world, and has no parent and the identity transform.
4. Scales to metres with the unit scale of a .blend file. The FBX importer applies the units of the file. An OBJ
   file has no units: a size above 10 units gives centimetres, and above 1,000 units gives millimetres (with a
   warning). A prop is smaller than the room (approximately 6 m), so a larger size is not in metres.
5. Moves the origin to the centre of the base: the middle of the bounds in X and Y, and the lowest Z.
6. Makes each image a PNG image of at most 2048 px, because the build encodes only PNG images to KTX2.
7. Exports the meshes as GLB with the fixed settings of export.py (Y up, metres).

The report (JSON) gives the meshes, the triangles, the size, the scale and the warnings.

The importer registry (packages/assets/src/import) also runs this script for a model with the default recipe. It
gives three more arguments. `--origin source` keeps the origin of the source (step 5 does not occur). `--scale <factor>`
replaces the unit of step 4. `--max-image <px>` replaces the largest image edge of step 6.

Run (from the workspace root; importDrop.ts calls it through runBlender of run.ts):
    blender -b --factory-startup --python packages/assets/blender/import_drop.py -- \
        --in <file> --out <glb> --report <json> [--origin base|source] [--scale auto|<factor>] [--max-image <px>]
"""

import argparse
import json
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from export import export

FORMATS = (".fbx", ".obj", ".blend", ".gltf", ".glb")
CONVERTIBLE = {"MESH", "CURVE", "SURFACE", "META", "FONT"}
MAX_IMAGE = 2048
#: An OBJ file larger than this (units) is in centimetres; larger than MILLIMETRES, in millimetres.
CENTIMETRES = 10.0
MILLIMETRES = 1000.0


def fail(message):
    print(f"import_drop: {message}", file=sys.stderr)
    sys.exit(1)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Make a GLB of a prop from a dropped file.")
    parser.add_argument("--in", dest="source", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--origin", choices=("base", "source"), default="base")
    parser.add_argument("--scale", default="auto", help="auto, or the factor from the units of the file to metres")
    parser.add_argument("--max-image", type=int, default=MAX_IMAGE)
    args = parser.parse_args(argv)
    if args.scale != "auto":
        try:
            args.scale = float(args.scale)
        except ValueError:
            fail(f"--scale is auto or a number, not {args.scale}")
        if args.scale <= 0:
            fail("--scale is a positive number")
    return args


def clear_scene():
    """Remove every object of the factory scene (the cube, the camera, the light)."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def import_file(path, ext):
    """Import an FBX, OBJ or glTF file. A .blend file is open already."""
    if ext == ".blend":
        return
    clear_scene()
    if ext == ".fbx":
        result = bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".obj":
        result = bpy.ops.wm.obj_import(filepath=path)
    else:
        result = bpy.ops.import_scene.gltf(filepath=path)
    if "FINISHED" not in result:
        fail(f"Blender did not import {os.path.basename(path)} ({result})")


def chosen_objects():
    """The objects of the collection "export" when it exists, else every visible object of the view layer."""
    collection = bpy.data.collections.get("export")
    if collection is not None:
        return list(collection.all_objects)
    return [obj for obj in bpy.context.view_layer.objects if obj.visible_get()]


def select(objects):
    for obj in bpy.context.view_layer.objects:
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]


def to_meshes(objects):
    """Make the instanced collections real, convert the objects to meshes and remove every other object."""
    instancers = [obj for obj in objects if obj.type == "EMPTY" and obj.instance_type == "COLLECTION"]
    if instancers:
        select(instancers)
        bpy.ops.object.duplicates_make_real()
        # At this point, the new objects are selected.
        objects = objects + [obj for obj in bpy.context.selected_objects if obj not in objects]
    convertible = [obj for obj in objects if obj.type in CONVERTIBLE]
    if not convertible:
        fail("the file has no visible mesh")
    select(convertible)
    bpy.ops.object.convert(target="MESH")
    meshes = [obj for obj in bpy.context.selected_objects if obj.type == "MESH" and len(obj.data.polygons) > 0]
    if not meshes:
        fail("the file has no mesh with faces")
    keep = set(meshes)
    for obj in list(bpy.data.objects):
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    return meshes


def apply_transforms(meshes):
    """Put the world transform of each mesh into its vertices: no parent, the identity transform."""
    worlds = {obj.name: obj.matrix_world.copy() for obj in meshes}
    for obj in meshes:
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        if obj.data.shape_keys is not None:
            obj.shape_key_clear()
        world = worlds[obj.name]
        obj.parent = None
        obj.data.transform(world)
        if world.determinant() < 0:
            obj.data.flip_normals()
        obj.matrix_world = Matrix.Identity(4)
        obj.data.update()


def bounds(meshes):
    """The smallest and the largest corner of the vertices of the meshes (world space)."""
    low = Vector((float("inf"),) * 3)
    high = Vector((float("-inf"),) * 3)
    for obj in meshes:
        for vertex in obj.data.vertices:
            for axis in range(3):
                low[axis] = min(low[axis], vertex.co[axis])
                high[axis] = max(high[axis], vertex.co[axis])
    return low, high


def unit_scale(ext, size, warnings):
    """The scale to metres: the unit scale of a .blend file; for an OBJ file, a guess from its size."""
    if ext == ".blend":
        return float(bpy.context.scene.unit_settings.scale_length) or 1.0
    if ext != ".obj":
        return 1.0
    if size > MILLIMETRES:
        warnings.append(f"the OBJ file is {size:.0f} units large: read as millimetres")
        return 0.001
    if size > CENTIMETRES:
        warnings.append(f"the OBJ file is {size:.0f} units large: read as centimetres")
        return 0.01
    return 1.0


def normalize(meshes, ext, warnings, origin="base", factor="auto"):
    """Scale to metres and move the origin to the centre of the base. Returns the scale and the size (metres).

    `origin` "source" keeps the origin of the source. A number `factor` replaces the unit of the file.
    """
    low, high = bounds(meshes)
    size = max(high - low)
    scale = unit_scale(ext, size, warnings) if factor == "auto" else factor
    base = Vector(((low.x + high.x) / 2, (low.y + high.y) / 2, low.z)) if origin == "base" else Vector()
    matrix = Matrix.Scale(scale, 4) @ Matrix.Translation(-base)
    for obj in meshes:
        obj.data.transform(matrix)
        obj.data.update()
    extent = (high - low) * scale
    return scale, extent


def png_images(warnings, max_image=MAX_IMAGE):
    """Make each image that a material uses a packed PNG image of at most `max_image` px."""
    converted = 0
    for image in list(bpy.data.images):
        if image.users == 0 or image.type != "IMAGE":
            continue
        width, height = image.size
        if width == 0 or height == 0:
            warnings.append(f"the image {image.name} has no pixels (a missing file): the material has no texture")
            bpy.data.images.remove(image)
            continue
        is_png = image.file_format == "PNG" and not (image.packed_file is None and image.filepath_raw == "")
        if is_png and max(width, height) <= max_image:
            continue
        if max(width, height) > max_image:
            factor = max_image / max(width, height)
            width, height = max(1, round(width * factor)), max(1, round(height * factor))
            image.scale(width, height)
        pixels = [0.0] * (width * height * 4)
        image.pixels.foreach_get(pixels)
        made = bpy.data.images.new(f"{image.name}_png", width, height, alpha=True)
        made.colorspace_settings.name = image.colorspace_settings.name
        made.pixels.foreach_set(pixels)
        made.file_format = "PNG"
        made.pack()
        image.user_remap(made)
        bpy.data.images.remove(image)
        converted += 1
    return converted


def triangles(meshes):
    count = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        count += len(obj.data.loop_triangles)
    return count


def main():
    args = parse_args()
    source = os.path.abspath(args.source)
    ext = os.path.splitext(source)[1].lower()
    if ext not in FORMATS:
        fail(f"{ext} is not a format of the import ({', '.join(FORMATS)})")
    warnings = []
    import_file(source, ext)
    meshes = to_meshes(chosen_objects())
    apply_transforms(meshes)
    scale, extent = normalize(meshes, ext, warnings, args.origin, args.scale)
    images = png_images(warnings, args.max_image)
    select(meshes)
    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    result = export(out, False)
    if "FINISHED" not in result:
        fail(f"the glTF export did not finish ({result})")
    report = {
        "meshes": len(meshes),
        "triangles": triangles(meshes),
        # glTF axes: x, the height (Blender z), the depth (Blender y).
        "extent": [round(extent.x, 4), round(extent.z, 4), round(extent.y, 4)],
        "scale": scale,
        "images": images,
        "warnings": warnings,
        "blender": bpy.app.version_string,
    }
    with open(os.path.abspath(args.report), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
    print(f"import_drop: wrote {out} ({report['meshes']} meshes, {report['triangles']} triangles)")


if __name__ == "__main__":
    main()
