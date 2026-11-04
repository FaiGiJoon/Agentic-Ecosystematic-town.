# Builds public/models/kit.glb: soft, bevelled unit shapes (box, cyl, cone, sphere) with a baked
# top-light gradient in vertex colours. Run: blender -b -P tools/make_kit.py
import bpy, bmesh, math, os

bpy.ops.wm.read_factory_settings(use_empty=True)
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'models', 'kit.glb')

def finish(obj, name, bevel=0.0, smooth_angle=40):
    obj.name = name
    obj.data.name = name
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if bevel:
        m = obj.modifiers.new('b', 'BEVEL'); m.width = bevel; m.segments = 3; m.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier='b')
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
    # vertex colours: darker toward the ground, brighter on top, like soft sky light
    me = obj.data
    attr = me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    for i, v in enumerate(me.vertices):
        t = max(0.0, min(1.0, v.co.z + 0.5))  # z is up in Blender; exporter maps to y
        k = 0.72 + 0.28 * t
        attr.data[i].color = (k, k, k, 1)
    mat = bpy.data.materials.new('kit'); mat.use_nodes = True
    me.materials.append(mat)
    obj.select_set(False)

bpy.ops.mesh.primitive_cube_add(size=1); finish(bpy.context.object, 'box', bevel=0.04)
bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=1, vertices=16); finish(bpy.context.object, 'cyl', bevel=0.03)
bpy.ops.mesh.primitive_cone_add(radius1=1, radius2=0, depth=1, vertices=16); finish(bpy.context.object, 'cone', bevel=0.02)
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=16, ring_count=10); finish(bpy.context.object, 'sphere')

os.makedirs(os.path.dirname(out), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=True, export_yup=True)
print('wrote', out)
