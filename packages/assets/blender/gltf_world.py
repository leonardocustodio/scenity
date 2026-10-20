# SPDX-License-Identifier: Apache-2.0
"""Import a glTF binary file and report the world place of each object.

The check of the glTF export of a scene (packages/assets/src/export) runs this script with the pinned Blender. The
script imports the file into an empty scene with the default settings of the glTF importer (glTF Y up becomes Blender
Z up). Then it prints one line for each object (the name, the type, and the world location in metres) and writes a
JSON report. For each object, the report gives the name, the type, the name of the parent and the entity ID from the
node extras (empty when the node has none). It also gives the world location and the world rotation (a quaternion
w, x, y, z), in the frame of Blender.

Run (from the workspace root; tests/exportBlender.test.ts calls it through runBlender of src/blender/run.ts):
    blender -b --factory-startup --python packages/assets/blender/gltf_world.py -- --in <glb> --out <json>
"""

import argparse
import json
import sys

import bpy


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Report the world place of each object of a glTF file.")
    parser.add_argument("--in", dest="source", required=True)
    parser.add_argument("--out", required=True)
    return parser.parse_args(argv)


def clear_scene():
    """Remove every object of the factory scene (the cube, the camera, the light)."""
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def entity_of(obj):
    """The entity ID of the node extras (a custom property of the object), or an empty string."""
    value = obj.get("entity")
    return value if isinstance(value, str) else ""


def report_of(obj):
    matrix = obj.matrix_world
    return {
        "name": obj.name,
        "type": obj.type,
        "parent": obj.parent.name if obj.parent is not None else "",
        "entity": entity_of(obj),
        "location": [round(part, 6) for part in matrix.to_translation()],
        "rotation": [round(part, 6) for part in matrix.to_quaternion()],
    }


def main():
    args = parse_args()
    clear_scene()
    result = bpy.ops.import_scene.gltf(filepath=args.source)
    if "FINISHED" not in result:
        print(f"gltf_world: the import of {args.source} failed", file=sys.stderr)
        sys.exit(1)
    bpy.context.view_layer.update()
    objects = [report_of(obj) for obj in sorted(bpy.data.objects, key=lambda item: item.name)]
    for item in objects:
        x, y, z = item["location"]
        print(f"gltf_world: {item['name']} {item['type']} {x:.6f} {y:.6f} {z:.6f}")
    with open(args.out, "w", encoding="utf-8") as file:
        json.dump({"source": args.source, "objects": objects}, file, indent=2)
        file.write("\n")


main()
