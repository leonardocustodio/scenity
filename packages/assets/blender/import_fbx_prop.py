# SPDX-License-Identifier: Apache-2.0
"""Make the Blender master of a static prop from an FBX.

A bought prop comes as an FBX with meshes, empties and materials. Examples are a piece of furniture of the Reallusion
ActorCore library, or a part of a scene FBX such as a wall panel. This script makes the master of the asset pipeline.
The paths of the spec are relative to `--root` (default: the working folder). The textures go into
`<root>/textures/<id>/`:

1. Import the FBX, or open a .blend file, or import a glTF or OBJ file. An example is the `normalized.glb` of a scratch
   prop that "Promote to the room" copies to imports/drop/<id>/. With `keep`, only the objects of those names and the
   objects under them stay. `drop` removes the objects of those names and the objects under them. Apply the transforms
   of the meshes (metres, Z up, no parents, no empties). `add` ([{model, at, turn, tilt, roll, drop}]) imports the
   meshes of more FBX files. It puts each one at `at` (metres in the frame of the first model). It rolls the meshes by
   `roll` degrees about Y, tilts them by `tilt` degrees about X, then turns them by `turn` degrees about Z. Examples
   are a tray on the top of a stand, or a syringe on the tray. The `drop` of an `add` entry removes the objects of
   those names from that file (for example the spare blades of a set).
2. Remove the parts of the meshes (connected pieces) whose bounds are in a box of `dropParts`. An example is the end
   panel of a frame where a member of the scene stands. `decimate` reduces each mesh with more triangles than `above`
   to `ratio` of its triangles. With `smooth`, the reduced mesh loses the custom normals of the FBX and gets smooth
   shading, because a collapse breaks the custom normals of a dense cloth (dark patches). `decimate` can also be a list
   of such specs, each for the meshes of `objects` (default: all meshes). A spec can have `unsubdivide` in place of
   `ratio`: a number of un-subdivide steps. Each step keeps approximately a quarter of the faces of a subdivided mesh,
   and the two layers of a thick cloth stay apart.
3. Lift the prop by `lift.by` metres above `lift.to`, and stretch the vertices between `lift.from` and `lift.to`. An
   example is the legs of a table with a height adjustment, so the top has the height of the room kit.
4. Give each source material the material of its texture set: the first key of `materials` that starts its name. A
   texture set has a color, a normal map (OpenGL convention in the master) and an ORM texture. In place of the ORM
   texture, it can have an Unreal `rma` texture (R roughness, G metalness, B occlusion), or separate `roughness` and
   `metallic` maps that the script packs into ORM. It can also have an `emissive` map (for example a screen that
   emits light). The script writes the maps as PNG files of the sizes of `textureSize` into textures/<id>/.
   With `recolor` [r, g, b] (sRGB), each texel of the color texture gets this color times its luminance over the
   median luminance (for example a white pillow from a tinted fabric). `metalness` (0 to 1) scales the metalness of
   the ORM texture. The room has no reflections, so a full metal renders black (for example a steel stand).
   A material without a texture set keeps its color, its color texture (at most `maxTextureSize` px), its roughness,
   its metalness and its alpha. `colors` replaces the color of the materials whose names start with a key. `fills`
   paints rectangles (u0, v0, u1, v1 in UV space) of their color texture with a color. An example is the display of a
   screen, where the renderer draws its own screen. `surfaces` replaces only the roughness and the metalness of the
   materials whose names start with a key, and the color texture stays. An example is a plastic part that the FBX
   gives as a polished metal, which renders black.
5. Join the meshes into one mesh "body", move `origin` to the origin, scale by `scale`, and put the body into the
   collection "export". With `bake` ({size, roughness, keep}), the colors of all materials go into one texture on a
   new UV layout (a Cycles bake of the diffuse color). Then the body has one material: one draw call in the renderer.
   The materials whose names start with a name of `keep` stay apart with their own texture and UVs. An example is the
   display of a screen, which needs its full texture size.
6. `sockets` ({name: {at, size, tilt}}, in the frame after `origin` and `scale`) adds empties for the renderer. An
   example is "display": the middle of the display of a screen, with its scale as the width and the height. The
   renderer puts its live screen or its "off" screen there. `tilt` is the angle in degrees that the top of the display
   leans back, so the display faces up a little. The prop faces -Y in Blender. The back of a prop is at +Y, so it is at
   -Z in the glTF file and in the room. The front of a wall part at -Y faces +Z in the room.
7. `parts` ({name: {objects, triangles, pivot}}) keeps the prop as separate meshes in place of one body. An example is
   a prop with a soft part: the renderer moves the parts apart and squeezes the soft part. Each part joins its
   objects, gets a reduction to approximately `triangles` triangles, and has its origin at `pivot` (in the frame of
   the FBX, metres). The script removes the objects of no part. A texture set can have a `glossiness` map in place of
   the roughness (the roughness is 1 minus the glossiness). It can also have a `clear` map ({map, opacity, threshold}),
   for example a 3ds Max refraction map. The polygons on clear texels go to a second material with alpha blend, whose
   alpha decreases to `opacity`. `splitParts` ({name: [{min, max, minVertices}]}, in the frame of the FBX) first moves
   some connected pieces of a mesh to a new object of that name. These are the pieces whose bounds are in a box and
   that have at least `minVertices` vertices. Thus a part can be a piece of one merged mesh (for example the handles
   in the holders of a device).

`--textures <folder>` puts the textures into `<folder>/<id>/` in place of `<root>/textures/<id>/`. The importer
registry (packages/assets/src/import) gives a work folder there, so the source folder gets no new files.

Run (from the workspace root, through runBlender of packages/assets/src/blender/run.ts):
    blender -b --factory-startup --python packages/assets/blender/import_fbx_prop.py -- --asset <id> --spec '<json>' \
        --out <blend> [--root <folder>] [--textures <folder>]
"""

import argparse
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from master_io import fail as stop
from master_io import make_material, pixels_of, save_master, save_png, select_only, source_path

# The folder of the source paths of the spec (the argument --root).
ROOT = "."
# The folder of the textures of the master (the argument --textures; default <root>/textures).
TEXTURES = "textures"


def fail(message):
    stop(message, "import_fbx_prop")


def art_path(relative):
    return source_path(ROOT, relative, "import_fbx_prop")


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset", required=True)
    parser.add_argument("--spec", required=True, help="the 'import' object of the asset list entry as JSON")
    parser.add_argument("--out", required=True)
    parser.add_argument("--root", default=".", help="the folder of the source paths and of textures/")
    parser.add_argument("--textures", default=None, help="the folder of the textures (default: <root>/textures)")
    return parser.parse_args(argv)


def texture_set(asset, name, files, sizes, alpha=None):
    """Write the color, normal, ORM (and emissive) PNG files of one texture set.

    `alpha` (one value per color pixel, or None for 1) is the alpha of the color texture. Returns (color, normal, orm,
    emissive or None).
    """
    folder = os.path.join(TEXTURES, asset)
    os.makedirs(folder, exist_ok=True)
    color_size = int(sizes.get("color", 1024))
    color = pixels_of(art_path(files["color"]), color_size, False)
    if "recolor" in files:
        import numpy as np

        luminance = 0.2126 * color[0::4] + 0.7152 * color[1::4] + 0.0722 * color[2::4]
        shade = np.clip(luminance / max(float(np.median(luminance)), 1e-4), 0.0, 1.15)
        for channel, value in enumerate(files["recolor"]):
            color[channel::4] = np.clip(float(value) * shade, 0.0, 1.0)
    color[3::4] = 1.0 if alpha is None else alpha
    normal_size = int(sizes.get("normal", 1024))
    normal = pixels_of(art_path(files["normal"]), normal_size, True)
    if files.get("normalConvention", "opengl") == "directx":
        normal[1::4] = 1.0 - normal[1::4]
    normal[3::4] = 1.0
    orm_size = int(sizes.get("orm", 1024))
    if "orm" in files:
        orm = pixels_of(art_path(files["orm"]), orm_size, True)
    elif "rma" in files:
        # An Unreal RMA map has the roughness in R, the metalness in G and the occlusion in B. ORM has the occlusion
        # in R, the roughness in G and the metalness in B.
        rma = pixels_of(art_path(files["rma"]), orm_size, True)
        orm = rma.copy()
        orm[0::4] = rma[2::4]
        orm[1::4] = rma[0::4]
        orm[2::4] = rma[1::4]
    elif "glossiness" in files:
        # A V-Ray glossiness map: the roughness is 1 minus the glossiness; no occlusion (1), no metalness (0).
        orm = pixels_of(art_path(files["glossiness"]), orm_size, True)
        orm[1::4] = 1.0 - orm[0::4]
        orm[0::4] = 1.0
        orm[2::4] = 0.0
    else:
        # No occlusion (1), the roughness in G and the metalness in B (the red channel of each map).
        orm = pixels_of(art_path(files["roughness"]), orm_size, True)
        orm[2::4] = pixels_of(art_path(files["metallic"]), orm_size, True)[0::4] if "metallic" in files else 0.0
        orm[1::4] = orm[0::4]
        orm[0::4] = 1.0
    if "metalness" in files:
        orm[2::4] = orm[2::4] * float(files["metalness"])
    orm[3::4] = 1.0
    prefix = f"{asset}_{name.lower()}"
    emissive = None
    if "emissive" in files:
        emissive_size = int(sizes.get("emissive", 1024))
        pixels = pixels_of(art_path(files["emissive"]), emissive_size, False)
        pixels[3::4] = 1.0
        emissive = save_png(
            f"{prefix}_emissive", pixels, emissive_size, os.path.join(folder, f"{prefix}_emissive.png"), False
        )
    return (
        save_png(f"{prefix}_color", color, color_size, os.path.join(folder, f"{prefix}_color.png"), False),
        save_png(f"{prefix}_normal", normal, normal_size, os.path.join(folder, f"{prefix}_normal.png"), True),
        save_png(f"{prefix}_orm", orm, orm_size, os.path.join(folder, f"{prefix}_orm.png"), True),
        emissive,
    )


def textured_material(asset, name, files, sizes):
    """The material of a texture set: color, normal map, ORM and an optional emissive map (glTF emissiveTexture)."""
    color, normal, orm, emissive = texture_set(asset, name, files, sizes)
    made = make_material(f"{asset}_{name.lower()}", color, normal, orm)
    if emissive is not None:
        nodes = made.node_tree.nodes
        bsdf = nodes["Principled BSDF"]
        node = nodes.new("ShaderNodeTexImage")
        node.image = emissive
        made.node_tree.links.new(node.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 1.0
    return made


def clear_materials(asset, name, files, sizes, clear):
    """The opaque and the clear material of a texture set with a `clear` map, and the clear value per color pixel.

    The color texture has the alpha 1 - (1 - opacity) * clear. The opaque material does not read the alpha; the clear
    material has alpha blend (glTF alphaMode BLEND).
    """
    color_size = int(sizes.get("color", 1024))
    amount = pixels_of(art_path(clear["map"]), color_size, True)[0::4].copy()
    opacity = float(clear.get("opacity", 0.4))
    color, normal, orm, _ = texture_set(asset, name, files, sizes, 1.0 - (1.0 - opacity) * amount)
    made = []
    for suffix, method in (("", "DITHERED"), ("_clear", "BLENDED")):
        material = make_material(f"{asset}_{name.lower()}{suffix}", color, normal, orm)
        nodes = material.node_tree.nodes
        links = material.node_tree.links
        bsdf = nodes["Principled BSDF"]
        for link in list(bsdf.inputs["Alpha"].links):
            links.remove(link)
        if method == "BLENDED":
            image = next(node for node in nodes if node.type == "TEX_IMAGE" and node.image == color)
            links.new(image.outputs["Alpha"], bsdf.inputs["Alpha"])
        material.surface_render_method = method
        made.append(material)
    return made[0], made[1], amount, color_size


def split_clear(ob, opaque, clear_made, amount, size, threshold):
    """Give the polygons of `ob` with the opaque material whose UV middle is on a clear texel the clear material."""
    mesh = ob.data
    if opaque not in list(mesh.materials):
        return 0
    if clear_made not in list(mesh.materials):
        mesh.materials.append(clear_made)
    opaque_index = list(mesh.materials).index(opaque)
    clear_index = list(mesh.materials).index(clear_made)
    uvs = mesh.uv_layers.active.data
    moved = 0
    for polygon in mesh.polygons:
        if polygon.material_index != opaque_index:
            continue
        u = sum(uvs[loop].uv[0] for loop in polygon.loop_indices) / polygon.loop_total
        v = sum(uvs[loop].uv[1] for loop in polygon.loop_indices) / polygon.loop_total
        x = min(size - 1, max(0, int((u % 1.0) * size)))
        y = min(size - 1, max(0, int((v % 1.0) * size)))
        if amount[y * size + x] > threshold:
            polygon.material_index = clear_index
            moved += 1
    return moved


def make_parts(asset, meshes, parts, origin, scale):
    """Join the meshes of each part into one object with its origin at the pivot of the part; return the objects."""
    by_name = {ob.name: ob for ob in meshes}
    # First remove the meshes of no part. A join removes the joined objects, so the list is stale after it.
    named = {name for spec in parts.values() for name in spec["objects"]}
    for name in [name for name in by_name if name not in named]:
        bpy.data.objects.remove(by_name.pop(name))
    made = []
    for part, spec in parts.items():
        missing = [name for name in spec["objects"] if name not in by_name]
        if missing:
            fail(f"the part {part} names no mesh {', '.join(missing)}")
        members = [by_name[name] for name in spec["objects"]]
        select_only(members, members[0])
        if len(members) > 1:
            bpy.ops.object.join()
        ob = members[0]
        ob.name = part
        ob.data.name = f"{asset}_{part}"
        ob.data.calc_loop_triangles()
        count = len(ob.data.loop_triangles)
        target = int(spec.get("triangles", count))
        if count > target:
            select_only([ob], ob)
            modifier = ob.modifiers.new("decimate", "DECIMATE")
            modifier.ratio = target / count
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        pivot = Vector(spec.get("pivot", origin))
        for vertex in ob.data.vertices:
            vertex.co = (vertex.co - pivot) * scale
        ob.data.update()
        ob.location = (pivot - origin) * scale
        made.append(ob)
    return made


def mesh_pieces(edit):
    """The connected pieces of a bmesh: lists of vertices."""
    edit.verts.ensure_lookup_table()
    seen = set()
    pieces = []
    for start in edit.verts:
        if start.index in seen:
            continue
        stack = [start]
        piece = []
        while stack:
            vertex = stack.pop()
            if vertex.index in seen:
                continue
            seen.add(vertex.index)
            piece.append(vertex)
            stack.extend(edge.other_vert(vertex) for edge in vertex.link_edges)
        pieces.append(piece)
    return pieces


def in_box(piece, box):
    """True when the bounds of a piece lie inside a box ({min, max, minVertices})."""
    if len(piece) < int(box.get("minVertices", 0)):
        return False
    for axis in range(3):
        low = min(vertex.co[axis] for vertex in piece)
        high = max(vertex.co[axis] for vertex in piece)
        if low < box["min"][axis] or high > box["max"][axis]:
            return False
    return True


def split_parts(meshes, split):
    """Move the pieces of the meshes that lie in the boxes of `split` ({name: [box]}) to new objects of those names."""
    made = []
    for name, boxes in split.items():
        for ob in list(meshes):
            edit = bmesh.new()
            edit.from_mesh(ob.data)
            chosen = {
                vertex.index
                for piece in mesh_pieces(edit)
                if any(in_box(piece, box) for box in boxes)
                for vertex in piece
            }
            edit.free()
            if not chosen:
                continue
            copy = ob.copy()
            copy.data = ob.data.copy()
            bpy.context.scene.collection.objects.link(copy)
            for target, keep_chosen in ((copy, True), (ob, False)):
                edit = bmesh.new()
                edit.from_mesh(target.data)
                edit.verts.ensure_lookup_table()
                gone = [vertex for vertex in edit.verts if (vertex.index in chosen) != keep_chosen]
                bmesh.ops.delete(edit, geom=gone, context="VERTS")
                edit.to_mesh(target.data)
                edit.free()
                target.data.update()
            copy.name = name
            made.append(copy)
            break
        else:
            fail(f"the split part {name} finds no piece in its boxes")
    return made


def drop_parts(ob, boxes):
    """Delete the connected pieces of a mesh whose bounds lie inside one of `boxes` ({min, max}, metres)."""
    edit = bmesh.new()
    edit.from_mesh(ob.data)
    edit.verts.ensure_lookup_table()
    seen = set()
    dropped = []
    for start in edit.verts:
        if start.index in seen:
            continue
        stack = [start]
        piece = []
        while stack:
            vertex = stack.pop()
            if vertex.index in seen:
                continue
            seen.add(vertex.index)
            piece.append(vertex)
            stack.extend(edge.other_vert(vertex) for edge in vertex.link_edges)
        low = Vector((min(v.co.x for v in piece), min(v.co.y for v in piece), min(v.co.z for v in piece)))
        high = Vector((max(v.co.x for v in piece), max(v.co.y for v in piece), max(v.co.z for v in piece)))
        for box in boxes:
            if all(box["min"][axis] <= low[axis] and high[axis] <= box["max"][axis] for axis in range(3)):
                dropped.extend(piece)
                break
    if dropped:
        bmesh.ops.delete(edit, geom=dropped, context="VERTS")
    edit.to_mesh(ob.data)
    edit.free()
    ob.data.update()
    return len(dropped)


def subtree(roots):
    """The objects of the given names and every object under them."""
    found = set()
    stack = [bpy.data.objects[name] for name in roots if name in bpy.data.objects]
    missing = [name for name in roots if name not in bpy.data.objects]
    if missing:
        fail(f"the FBX has no object {', '.join(missing)}")
    while stack:
        ob = stack.pop()
        if ob in found:
            continue
        found.add(ob)
        stack.extend(ob.children)
    return found


def decimate(ob, spec):
    """Collapse (or un-subdivide) a mesh with more than `above` triangles."""
    ob.data.calc_loop_triangles()
    if len(ob.data.loop_triangles) <= int(spec["above"]):
        return
    select_only([ob], ob)
    modifier = ob.modifiers.new("decimate", "DECIMATE")
    if "unsubdivide" in spec:
        modifier.decimate_type = "UNSUBDIV"
        modifier.iterations = int(spec["unsubdivide"])
    else:
        modifier.ratio = float(spec["ratio"])
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    if spec.get("smooth", False):
        bpy.ops.mesh.customdata_custom_splitnormals_clear()
        bpy.ops.object.shade_smooth()


def import_model(path):
    """Import a model file into the scene: FBX, glTF (.glb, .gltf) or OBJ (for example the model of a promoted prop)."""
    suffix = os.path.splitext(path)[1].lower()
    if suffix in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif suffix == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif suffix == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path, use_anim=False, use_custom_normals=True)
    else:
        fail(f"the prop import reads .fbx, .glb, .gltf, .obj or .blend, not {suffix or 'a file without a suffix'}")


def add_models(extras):
    """Import the meshes of the model files of `add` at their places (no parents, the transforms applied)."""
    added_meshes = []
    for extra in extras:
        before = set(bpy.data.objects)
        import_model(art_path(extra["model"]))
        added = [ob for ob in bpy.data.objects if ob not in before]
        unwanted = set(extra.get("drop", []))
        for ob in [ob for ob in added if ob.name in unwanted]:
            added.remove(ob)
            bpy.data.objects.remove(ob)
        meshes = [ob for ob in added if ob.type == "MESH"]
        if not meshes:
            fail(f"no mesh in {extra['model']}")
        select_only(meshes, meshes[0])
        bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
        for ob in [ob for ob in added if ob not in meshes]:
            bpy.data.objects.remove(ob)
        place = (
            Matrix.Translation(Vector(extra.get("at", (0.0, 0.0, 0.0))))
            @ Matrix.Rotation(math.radians(float(extra.get("turn", 0.0))), 4, "Z")
            @ Matrix.Rotation(math.radians(float(extra.get("tilt", 0.0))), 4, "X")
            @ Matrix.Rotation(math.radians(float(extra.get("roll", 0.0))), 4, "Y")
        )
        for ob in meshes:
            ob.matrix_world = place @ ob.matrix_world
        select_only(meshes, meshes[0])
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        added_meshes.extend(meshes)
    return added_meshes


def fill_rects(image, rects):
    """Paint rectangles of an image ({rect: [u0, v0, u1, v1], color: [r, g, b]}, UV space: v up)."""
    import numpy as np

    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(height, width, 4)
    for item in rects:
        u0, v0, u1, v1 = item["rect"]
        pixels[int(v0 * height) : int(v1 * height), int(u0 * width) : int(u1 * width), :3] = item["color"]
    image.pixels.foreach_set(pixels.ravel())
    image.update()
    image.pack()


def simplify_material(material, colors, max_size, fills=(), surface=None):
    """Keep the color (or the color texture), the roughness, the metalness and the alpha of a material."""
    if material.node_tree is None:
        return
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = next((node for node in nodes if node.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        return
    for link in list(links):
        if link.to_node == bsdf and link.to_socket.name not in ("Base Color",):
            links.remove(link)
    override = next((value for key, value in colors.items() if material.name.startswith(key)), None)
    if override is not None:
        for link in list(links):
            if link.to_node == bsdf:
                links.remove(link)
        bsdf.inputs["Base Color"].default_value = (*override["color"], 1.0)
        bsdf.inputs["Roughness"].default_value = float(override.get("roughness", 0.5))
        bsdf.inputs["Metallic"].default_value = float(override.get("metallic", 0.0))
    if surface is not None:
        for name in ("Roughness", "Metallic"):
            for link in list(bsdf.inputs[name].links):
                links.remove(link)
        bsdf.inputs["Roughness"].default_value = float(surface.get("roughness", 0.5))
        bsdf.inputs["Metallic"].default_value = float(surface.get("metallic", 0.0))
    for node in list(nodes):
        if node.type == "TEX_IMAGE" and not node.outputs["Color"].is_linked:
            nodes.remove(node)
            continue
        if node.type == "TEX_IMAGE" and node.image is not None and max(node.image.size) > max_size:
            node.image.scale(max_size, max_size)
        if node.type == "TEX_IMAGE" and node.image is not None and fills:
            fill_rects(node.image, fills)
    bsdf.inputs["Specular IOR Level"].default_value = 0.5
    bsdf.inputs["Emission Strength"].default_value = 0.0


def bake_colors(asset, body, spec):
    """Bake the diffuse colors of every material of `body` into one texture; give the body one material."""
    size = int(spec["size"])
    mesh = body.data
    kept = [
        index
        for index, material in enumerate(mesh.materials)
        if material is not None and any(material.name.startswith(name) for name in spec.get("keep", []))
    ]
    # Find the UV layers by name, because a new layer makes the earlier Python references to the layers stale.
    source_name = mesh.uv_layers.active.name
    mesh.uv_layers.new(name="bake")
    mesh.uv_layers.active = mesh.uv_layers["bake"]
    for layer in mesh.uv_layers:
        layer.active_render = layer.name == source_name
    # The new UV layout for the baked faces only; the kept faces keep their own UVs.
    for polygon in mesh.polygons:
        polygon.select = polygon.material_index not in kept
    select_only([body], body)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_mode(type="FACE")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.003, area_weight=0.0, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    source = mesh.uv_layers[source_name].data
    target = mesh.uv_layers["bake"].data
    for polygon in mesh.polygons:
        if polygon.material_index in kept:
            for loop in polygon.loop_indices:
                target[loop].uv = source[loop].uv
    image = bpy.data.images.new(f"{asset}_color", size, size, alpha=False)
    scratch = bpy.data.images.new(f"{asset}_scratch", 8, 8, alpha=False)
    nodes_added = []
    for index, material in enumerate(mesh.materials):
        if material is None or material.node_tree is None:
            continue
        if index in kept:
            # The bake needs a target in every material: the kept materials write into a scratch image.
            node = material.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = scratch
            material.node_tree.nodes.active = node
            nodes_added.append((material, node))
            continue
        # The diffuse color pass has no color for a metal or a glass: bake every material as an opaque dielectric.
        for bsdf in [node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"]:
            for name, value in (("Metallic", 0.0), ("Transmission Weight", 0.0), ("Alpha", 1.0)):
                for link in list(bsdf.inputs[name].links):
                    material.node_tree.links.remove(link)
                bsdf.inputs[name].default_value = value
        node = material.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        material.node_tree.nodes.active = node
        nodes_added.append((material, node))
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 4
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.use_pass_color = True
    scene.render.bake.margin = 4
    bpy.ops.object.bake(type="DIFFUSE")
    for material, node in nodes_added:
        material.node_tree.nodes.remove(node)
    bpy.data.images.remove(scratch)
    folder = os.path.join(TEXTURES, asset)
    os.makedirs(folder, exist_ok=True)
    image.filepath_raw = os.path.abspath(os.path.join(folder, f"{asset}_color.png"))
    image.file_format = "PNG"
    image.save()
    baked = bpy.data.materials.new(asset)
    baked.use_nodes = True
    bsdf = baked.node_tree.nodes["Principled BSDF"]
    texture = baked.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    baked.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = float(spec.get("roughness", 0.5))
    bsdf.inputs["Metallic"].default_value = 0.0
    # Slot 0: the baked material; then the kept materials (the polygons move to their new slots).
    kept_materials = [mesh.materials[index] for index in kept]
    slot_of = {old: new + 1 for new, old in enumerate(kept)}
    indices = [slot_of.get(polygon.material_index, 0) for polygon in mesh.polygons]
    mesh.materials.clear()
    mesh.materials.append(baked)
    for material in kept_materials:
        mesh.materials.append(material)
    for polygon, index in zip(mesh.polygons, indices, strict=True):
        polygon.material_index = index
    mesh.uv_layers.remove(mesh.uv_layers[source_name])
    mesh.uv_layers["bake"].name = "UVMap"
    mesh.uv_layers.active = mesh.uv_layers["UVMap"]
    mesh.uv_layers["UVMap"].active_render = True


def lift(ob, spec):
    """Move every vertex above `to` up by `by`; stretch the vertices between `from` and `to`."""
    low, high, by = float(spec["from"]), float(spec["to"]), float(spec["by"])
    for vertex in ob.data.vertices:
        z = vertex.co.z
        if z >= high:
            vertex.co.z = z + by
        elif z > low:
            vertex.co.z = z + by * (z - low) / (high - low)
    ob.data.update()


def export_parts(args, spec, meshes, dropped):
    """Save the master of a prop with `parts`: one object per part and the sockets in the collection "export"."""
    origin = Vector(spec.get("origin", (0.0, 0.0, 0.0)))
    scale = float(spec.get("scale", 1.0))
    objects = make_parts(args.asset, meshes, spec["parts"], origin, scale)
    collection = bpy.data.collections.new("export")
    bpy.context.scene.collection.children.link(collection)
    for ob in objects:
        for modifier in list(ob.modifiers):
            ob.modifiers.remove(modifier)
        for owner in list(ob.users_collection):
            owner.objects.unlink(ob)
        collection.objects.link(ob)
    for name, socket in spec.get("sockets", {}).items():
        empty = bpy.data.objects.new(name, None)
        empty.empty_display_type = "PLAIN_AXES"
        empty.location = socket["at"]
        width, height = socket.get("size", (1.0, 1.0))
        empty.scale = (width, 1.0, height)
        # The display faces -Y: a turn about X by minus the tilt leans its top back (+Y).
        empty.rotation_euler = (-math.radians(float(socket.get("tilt", 0.0))), 0.0, 0.0)
        collection.objects.link(empty)
    used = {material for ob in objects for material in ob.data.materials if material is not None}
    keep = {
        node.image
        for material in used
        if material.node_tree is not None
        for node in material.node_tree.nodes
        if node.type == "TEX_IMAGE" and node.image is not None
    }
    for image in list(bpy.data.images):
        if image not in keep:
            bpy.data.images.remove(image)
    for old in list(bpy.data.materials):
        if old not in used:
            bpy.data.materials.remove(old)
    bpy.data.orphans_purge(do_recursive=True)
    parts = {}
    for ob in objects:
        ob.data.calc_loop_triangles()
        parts[ob.name] = {
            "triangles": len(ob.data.loop_triangles),
            "at": [round(value, 4) for value in ob.location],
            "materials": [material.name for material in ob.data.materials if material is not None],
        }
    print("IMPORT_REPORT " + json.dumps({"asset": args.asset, "dropped_vertices": dropped, "parts": parts}))
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    save_master(args.out)


def main():
    global ROOT, TEXTURES
    args = parse_args()
    ROOT = args.root
    TEXTURES = args.textures or os.path.join(ROOT, "textures")
    spec = json.loads(args.spec)
    if spec["model"].endswith(".blend"):
        bpy.ops.wm.open_mainfile(filepath=art_path(spec["model"]))
    else:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        import_model(art_path(spec["model"]))
    wanted = subtree(spec["keep"]) if "keep" in spec else set(bpy.data.objects)
    unwanted = subtree(spec.get("drop", []))
    meshes = [ob for ob in bpy.data.objects if ob.type == "MESH" and ob in wanted and ob not in unwanted]
    if not meshes:
        fail("no mesh in the FBX")
    # Clear the parents first (each mesh keeps its place), then remove the other objects.
    select_only(meshes, meshes[0])
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for ob in [ob for ob in bpy.data.objects if ob not in meshes]:
        bpy.data.objects.remove(ob)
    meshes = meshes + add_models(spec.get("add", []))

    dropped = sum(drop_parts(ob, spec.get("dropParts", [])) for ob in meshes)
    if "splitParts" in spec:
        meshes = meshes + split_parts(meshes, spec["splitParts"])
    if "decimate" in spec:
        specs = spec["decimate"] if isinstance(spec["decimate"], list) else [spec["decimate"]]
        for part in specs:
            names = set(part.get("objects", []))
            for ob in meshes:
                if not names or ob.name in names:
                    decimate(ob, part)

    sets = spec.get("materials", {})
    sizes = spec.get("textureSize", {})
    clears = []
    made = {}
    for name, files in sets.items():
        if "clear" in files:
            opaque, clear_made, amount, size = clear_materials(args.asset, name, files, sizes, files["clear"])
            made[name] = opaque
            clears.append((opaque, clear_made, amount, size, float(files["clear"].get("threshold", 0.5))))
        else:
            made[name] = textured_material(args.asset, name, files, sizes)
    order = list(made)
    # Replace each material of a texture set in its slot (the polygons keep their slot); the join merges the same
    # materials. The other materials stay, simplified.
    kept = set()
    for ob in meshes:
        for index, material in enumerate(ob.data.materials):
            key = next((name for name in order if material is not None and material.name.startswith(name)), None)
            if key is not None:
                ob.data.materials[index] = made[key]
            elif material is not None:
                kept.add(material)
    for material in kept:
        fills = next((value for key, value in spec.get("fills", {}).items() if material.name.startswith(key)), ())
        surface = next(
            (value for key, value in spec.get("surfaces", {}).items() if material.name.startswith(key)), None
        )
        simplify_material(material, spec.get("colors", {}), int(spec.get("maxTextureSize", 1024)), fills, surface)
    for opaque, clear_made, amount, size, threshold in clears:
        for ob in meshes:
            split_clear(ob, opaque, clear_made, amount, size, threshold)
    if "parts" in spec:
        export_parts(args, spec, meshes, dropped)
        return
    body = max(meshes, key=lambda ob: len(ob.data.vertices))
    select_only(meshes, body)
    bpy.ops.object.join()
    body.name = "body"
    body.data.name = f"{args.asset}_body"
    if "lift" in spec:
        lift(body, spec["lift"])
    if "bake" in spec:
        bake_colors(args.asset, body, spec["bake"])
    origin = Vector(spec.get("origin", (0.0, 0.0, 0.0)))
    scale = float(spec.get("scale", 1.0))
    for vertex in body.data.vertices:
        vertex.co = (vertex.co - origin) * scale
    body.data.update()
    for modifier in list(body.modifiers):
        body.modifiers.remove(modifier)

    collection = bpy.data.collections.new("export")
    bpy.context.scene.collection.children.link(collection)
    for owner in list(body.users_collection):
        owner.objects.unlink(body)
    collection.objects.link(body)
    for name, socket in spec.get("sockets", {}).items():
        empty = bpy.data.objects.new(name, None)
        empty.empty_display_type = "PLAIN_AXES"
        empty.location = socket["at"]
        width, height = socket.get("size", (1.0, 1.0))
        # Blender Z is up: the glTF scale is (width, height, 1).
        empty.scale = (width, 1.0, height)
        # The display faces -Y: a turn about X by minus the tilt leans its top back (+Y).
        empty.rotation_euler = (-math.radians(float(socket.get("tilt", 0.0))), 0.0, 0.0)
        collection.objects.link(empty)
    used = {material for material in body.data.materials if material is not None}
    keep = {
        node.image
        for material in used
        if material.node_tree is not None
        for node in material.node_tree.nodes
        if node.type == "TEX_IMAGE" and node.image is not None
    }
    for image in list(bpy.data.images):
        if image not in keep:
            bpy.data.images.remove(image)
    for old in list(bpy.data.materials):
        if old not in used:
            bpy.data.materials.remove(old)
    bpy.data.orphans_purge(do_recursive=True)

    body.data.calc_loop_triangles()
    low = Vector([min(v.co[axis] for v in body.data.vertices) for axis in range(3)])
    high = Vector([max(v.co[axis] for v in body.data.vertices) for axis in range(3)])
    report = {
        "asset": args.asset,
        "triangles": len(body.data.loop_triangles),
        "dropped_vertices": dropped,
        "materials": [material.name for material in body.data.materials if material is not None],
        "bbox_min": [round(value, 3) for value in low],
        "bbox_max": [round(value, 3) for value in high],
    }
    print("IMPORT_REPORT " + json.dumps(report))
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    save_master(args.out)


if __name__ == "__main__":
    main()
