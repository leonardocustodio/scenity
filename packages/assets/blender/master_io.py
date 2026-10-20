# SPDX-License-Identifier: Apache-2.0
"""The shared helpers of the Blender importers: the source paths, the texture pixels, the PNG files, the
material of a texture set and the save of a master.

The importers of this folder and the importers of a project plugin import this module. Put the folder of this file
on `sys.path` first.
"""

import os
import sys

import bpy
import numpy as np


def fail(message, tool="import"):
    print(f"{tool}: {message}", file=sys.stderr)
    sys.exit(1)


def save_master(path):
    """Save a master with paths relative to the file, so the master opens the same images on all machines. In the
    toolchain image, /work is the workspace root. On macOS, it is the folder of the checkout."""
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path), relative_remap=True, compress=False)
    bpy.ops.file.make_paths_relative()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(path), relative_remap=True, compress=False)


def source_path(root, relative, tool="import"):
    """The absolute path of a source file relative to `root`. Stops with an error when the file does not exist."""
    path = os.path.join(root, relative)
    if not os.path.isfile(path):
        fail(f"no file {path}", tool)
    return os.path.abspath(path)


def pixels_of(path, size, non_color):
    image = bpy.data.images.load(path, check_existing=False)
    if non_color:
        image.colorspace_settings.name = "Non-Color"
    if image.size[0] != size or image.size[1] != size:
        image.scale(size, size)
    data = np.empty(size * size * 4, dtype=np.float32)
    image.pixels.foreach_get(data)
    bpy.data.images.remove(image)
    return data


def save_png(name, data, size, path, non_color):
    image = bpy.data.images.new(name, size, size, alpha=True)
    if non_color:
        image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(data)
    image.filepath_raw = os.path.abspath(path)
    image.file_format = "PNG"
    image.save()
    return image


def occlusion_group():
    """The node group "glTF Material Output": the glTF exporter reads the occlusion texture from it."""
    group = bpy.data.node_groups.get("glTF Material Output")
    if group is not None:
        return group
    group = bpy.data.node_groups.new("glTF Material Output", "ShaderNodeTree")
    group.interface.new_socket(name="Occlusion", in_out="INPUT", socket_type="NodeSocketFloat")
    group.interface.new_socket(name="Thickness", in_out="INPUT", socket_type="NodeSocketFloat")
    return group


def make_material(name, color_image, normal_image, orm_image):
    """Principled BSDF with color, alpha clip (Math Round: glTF alphaMode MASK), normal map and ORM."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes["Principled BSDF"]
    color = nodes.new("ShaderNodeTexImage")
    color.image = color_image
    links.new(color.outputs["Color"], bsdf.inputs["Base Color"])
    clip = nodes.new("ShaderNodeMath")
    clip.operation = "ROUND"
    links.new(color.outputs["Alpha"], clip.inputs[0])
    links.new(clip.outputs["Value"], bsdf.inputs["Alpha"])
    normal = nodes.new("ShaderNodeTexImage")
    normal.image = normal_image
    normal_map = nodes.new("ShaderNodeNormalMap")
    links.new(normal.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], bsdf.inputs["Normal"])
    orm = nodes.new("ShaderNodeTexImage")
    orm.image = orm_image
    split = nodes.new("ShaderNodeSeparateColor")
    links.new(orm.outputs["Color"], split.inputs["Color"])
    links.new(split.outputs["Green"], bsdf.inputs["Roughness"])
    links.new(split.outputs["Blue"], bsdf.inputs["Metallic"])
    output = nodes.new("ShaderNodeGroup")
    output.node_tree = occlusion_group()
    links.new(split.outputs["Red"], output.inputs["Occlusion"])
    material.surface_render_method = "DITHERED"
    return material


def select_only(objects, active):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = active
