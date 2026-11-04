# Builds public/models/kit.glb, the soft shapes koala inventions are drawn with.
# Run: blender -b -P tools/make_kit.py
# Every piece is modelled to fill a unit box (centred on the origin, y up, front towards +z), so the
# page just scales it to the size the build wants. Vertex colours carry a soft top-light gradient
# and a little detail (window bars, door boards, flower centres); the page tints them per build.
import bpy, bmesh, math, os
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'models', 'kit.glb')

# Author in three.js space (x right, y up, z toward the viewer); Blender is z-up, y-forward.
def B(x, y, z): return (x, -z, y)

def colour(me, k):
    a = me.color_attributes.get('Color') or me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    for d in a.data: d.color = (k, k, k, 1)

def obj_from(name, verts, faces, k=1.0):
    me = bpy.data.meshes.new(name)
    me.from_pydata([B(*v) for v in verts], [], faces)
    me.update()
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    colour(me, k)
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o

def box(cx, cy, cz, sx, sy, sz, k=1.0):
    x, y, z = sx / 2, sy / 2, sz / 2
    v = [(cx + a * x, cy + b * y, cz + c * z) for a in (-1, 1) for b in (-1, 1) for c in (-1, 1)]
    f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return obj_from('b', v, f, k)

def extrude(pts, depth, k=1.0, z0=0.0):
    """A flat outline in x,y, thickened along z."""
    n = len(pts)
    v = [(x, y, z0 - depth / 2) for x, y in pts] + [(x, y, z0 + depth / 2) for x, y in pts]
    f = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    f += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return obj_from('e', v, f, k)

def lathe(profile, steps=16, k=1.0):
    """Spin a (radius, height) profile about the y axis."""
    verts, faces = [], []
    m = len(profile)
    for s in range(steps):
        a = 2 * math.pi * s / steps
        for r, h in profile: verts.append((r * math.cos(a), h, r * math.sin(a)))
    for s in range(steps):
        s2 = (s + 1) % steps
        for i in range(m - 1):
            faces.append((s * m + i, s * m + i + 1, s2 * m + i + 1, s2 * m + i))
    return obj_from('l', verts, faces, k)

def sphere(cx, cy, cz, r, k=1.0, sy=1.0):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=12, ring_count=8, location=B(cx, cy, cz))
    o = bpy.context.object
    o.scale = (1, 1, sy); bpy.ops.object.transform_apply(scale=True)
    colour(o.data, k)
    return o

def join(parts, name):
    bpy.ops.object.select_all(action='DESELECT')
    for p in parts: p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1: bpy.ops.object.join()
    o = bpy.context.object
    o.name = name; o.data.name = name
    return o

def finish(o, name, bevel=0.0, smooth=40, fit=True, grad=True):
    o.name = name; o.data.name = name
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.select_all(action='DESELECT'); o.select_set(True)
    if fit:  # scale to fill the unit box, centred
        co = [v.co for v in o.data.vertices]
        lo = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
        hi = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
        size, mid = hi - lo, (hi + lo) / 2
        for v in o.data.vertices:
            v.co = Vector(((v.co[i] - mid[i]) / size[i] if size[i] > 1e-6 else 0 for i in range(3)))
    if bevel:
        m = o.modifiers.new('b', 'BEVEL'); m.width = bevel; m.segments = 2; m.limit_method = 'ANGLE'
        bpy.ops.object.modifier_apply(modifier='b')
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth))
    if grad:  # darker toward the ground, brighter on top (z is up in Blender)
        a = o.data.color_attributes['Color']
        for i, v in enumerate(o.data.vertices):
            t = max(0.0, min(1.0, v.co.z + 0.5)); g = 0.72 + 0.28 * t
            c = a.data[i].color; a.data[i].color = (c[0] * g, c[1] * g, c[2] * g, 1)
    o.data.materials.append(bpy.data.materials.new('kit'))
    o.select_set(False)
    return o

TAU = math.pi * 2

# --- the plain four -------------------------------------------------------------------
bpy.ops.mesh.primitive_cube_add(size=1); o = bpy.context.object; colour(o.data, 1); finish(o, 'box', bevel=0.04, fit=False)
bpy.ops.mesh.primitive_cylinder_add(radius=1, depth=1, vertices=16); o = bpy.context.object; colour(o.data, 1); finish(o, 'cyl', bevel=0.03, fit=False)
bpy.ops.mesh.primitive_cone_add(radius1=1, radius2=0, depth=1, vertices=16); o = bpy.context.object; colour(o.data, 1); finish(o, 'cone', bevel=0.02, fit=False)
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=16, ring_count=10); o = bpy.context.object; colour(o.data, 1); finish(o, 'sphere', fit=False)

# --- roofs ------------------------------------------------------------------------------
# gable: ridge along x, overhanging eaves, a thick slab so it reads as shingles
finish(join([obj_from('g', [(-1, 0, -1), (1, 0, -1), (1, 0, 1), (-1, 0, 1), (-1, 1, 0), (1, 1, 0)],
                      [(0, 1, 2, 3)[::-1], (0, 4, 5, 1)[::-1], (3, 2, 5, 4), (0, 3, 4), (1, 5, 2)[::-1]]),
              box(0, 1.0, 0, 2.1, 0.07, 0.12, 0.8)], 'gable'), 'gable', bevel=0.02, smooth=60)
# pyramid
finish(obj_from('p', [(-1, 0, -1), (1, 0, -1), (1, 0, 1), (-1, 0, 1), (0, 1, 0)],
                [(3, 2, 1, 0), (0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)]), 'pyramid', bevel=0.02, smooth=60)
# dome: a half sphere with a rim
dome = lathe([(0.0, 1.0), (0.38, 0.93), (0.71, 0.71), (0.93, 0.38), (1.0, 0.0), (1.06, 0.0), (1.06, -0.06), (0.0, -0.06)], 20)
finish(dome, 'dome')
# bell
bell = lathe([(0.0, 1.0), (0.12, 0.96), (0.3, 0.7), (0.4, 0.3), (0.5, 0.05), (0.56, 0.0), (0.46, 0.0), (0.3, 0.2), (0.0, 0.5)], 14)
finish(join([bell, sphere(0, -0.02, 0, 0.1, 0.5)], 'bell'), 'bell')

# --- flat shapes ------------------------------------------------------------------------
star = []
for i in range(10):
    r = 1.0 if i % 2 == 0 else 0.45
    a = math.pi / 2 + i * math.pi / 5
    star.append((r * math.cos(a), r * math.sin(a)))
finish(extrude(star, 0.5), 'star', bevel=0.03, smooth=50)
finish(extrude([(-0.5, -0.5), (0.5, -0.5), (0.2, 0.0), (0.5, 0.5), (-0.5, 0.5)], 0.3), 'pennant', smooth=80)

# door: arched top with boards (lighter) and a knob
arch = [(-0.5, -0.5), (0.5, -0.5)] + [(0.5 * math.cos(math.pi * i / 10), 0.1 + 0.4 * math.sin(math.pi * i / 10)) for i in range(0, 11)] + [(-0.5, -0.5)][:0]
door = [extrude(arch, 0.6, 1.0, 0.0)]
door += [box(0, -0.05, 0.34, 0.03, 0.85, 0.1, 0.6), box(-0.2, -0.05, 0.34, 0.03, 0.8, 0.1, 0.6), box(0.2, -0.05, 0.34, 0.03, 0.8, 0.1, 0.6), sphere(0.32, -0.1, 0.4, 0.06, 1.3)]
finish(join(door, 'door'), 'door', smooth=30)
# window: frame, cross bars, pane
win = [box(0, 0, 0, 0.9, 0.9, 0.2, 1.0)]
win += [box(0, 0.5 - 0.06, 0.07, 1.0, 0.12, 0.2, 0.55), box(0, -0.5 + 0.06, 0.07, 1.0, 0.12, 0.2, 0.55),
        box(-0.5 + 0.06, 0, 0.07, 0.12, 1.0, 0.2, 0.55), box(0.5 - 0.06, 0, 0.07, 0.12, 1.0, 0.2, 0.55),
        box(0, 0, 0.09, 1.0, 0.07, 0.2, 0.55), box(0, 0, 0.09, 0.07, 1.0, 0.2, 0.55)]
finish(join(win, 'window'), 'window', smooth=20)

# --- machines & play ----------------------------------------------------------------------
rim = bpy.ops.mesh.primitive_torus_add(major_radius=0.42, minor_radius=0.07, major_segments=20, minor_segments=8)
rim = bpy.context.object; rim.rotation_euler = (0, math.pi / 2, 0); bpy.ops.object.transform_apply(rotation=True); colour(rim.data, 0.6)
wheel = [rim]
for i in range(6):
    sp = box(0, 0, 0, 0.07, 0.84, 0.07, 0.8)
    sp.rotation_euler = (math.pi * i / 6, 0, 0)  # about the wheel's axis (x)
    bpy.context.view_layer.objects.active = sp; sp.select_set(True); bpy.ops.object.transform_apply(rotation=True); sp.select_set(False)
    wheel.append(sp)
hub = box(0, 0, 0, 0.18, 0.16, 0.16, 1.2); wheel.append(hub)
finish(join(wheel, 'wheel'), 'wheel')
# slide: bed with side rails
finish(join([box(0, 0, 0, 0.5, 0.06, 1.4, 1.0), box(-0.22, 0.07, 0, 0.06, 0.14, 1.4, 0.7), box(0.22, 0.07, 0, 0.06, 0.14, 1.4, 0.7)], 'slide'), 'slide', bevel=0.01)
# chimney: stone body, wider cap
finish(join([box(0, 0, 0, 0.8, 1.0, 0.8, 0.85), box(0, 0.5, 0, 1.0, 0.18, 1.0, 1.1), box(0, -0.1, 0.41, 0.85, 0.05, 0.02, 0.6)], 'chimney'), 'chimney', bevel=0.03)

# --- boat ---------------------------------------------------------------------------------
# a hull lofted along x: pointed bow at +x, broad stern, rounded belly, rising gunwale at the bow
ST, RN = 14, 9
verts, faces = [], []
for i in range(ST + 1):
    x = -1 + 2 * i / ST
    beam = 0.5 * (1 - max(0, x) ** 2) ** 0.6 * (0.85 + 0.15 * (1 - (x + 1) / 2)) + 0.01
    top = 0.0 + 0.18 * max(0, x) ** 2
    depth = 0.55 * (1 - 0.35 * max(0, x))
    for j in range(RN):
        p = math.pi * j / (RN - 1)
        verts.append((x, top - depth * math.sin(p), -beam * math.cos(p)))
for i in range(ST):
    for j in range(RN - 1):
        a, b = i * RN + j, (i + 1) * RN + j
        faces.append((a, a + 1, b + 1, b))
hull = obj_from('h', verts, faces, 1.0)
bm = bmesh.new(); bm.from_mesh(hull.data)
edges = [e for e in bm.edges if e.is_boundary]
bmesh.ops.holes_fill(bm, edges=edges, sides=0)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(hull.data); bm.free()
hull.data.polygons.foreach_set('use_smooth', [True] * len(hull.data.polygons))
finish(join([hull, box(0, 0.0, 0, 1.6, 0.04, 0.7, 0.6)], 'hull'), 'hull', smooth=50)
# sail: a triangle with a belly
sail_pts = []
N = 6
sv, sf = [], []
for r in range(N + 1):
    for c in range(N + 1 - r):
        u, v = c / N, r / N
        sv.append((-0.5 + u + (0.0 if True else 0) - 0.0 * v - 0.5 * 0, -0.5 + v, 0.1 * math.sin(math.pi * u * 0.9) * (1 - v)))
idx = {}
k = 0
for r in range(N + 1):
    for c in range(N + 1 - r):
        idx[(r, c)] = k; k += 1
for r in range(N):
    for c in range(N - r):
        sf.append((idx[(r, c)], idx[(r, c + 1)], idx[(r + 1, c)]))
        if c + 1 < N - r: sf.append((idx[(r, c + 1)], idx[(r + 1, c + 1)], idx[(r + 1, c)]))
sail = obj_from('s', [(x * 1.0, y, z) for x, y, z in sv], sf, 1.0)
sol = sail.modifiers.new('s', 'SOLIDIFY'); sol.thickness = 0.03
bpy.context.view_layer.objects.active = sail; bpy.ops.object.modifier_apply(modifier='s')
finish(sail, 'sail', smooth=80)

# --- flower: five petals round a darker heart, lying flat ------------------------------------
fl = [sphere(0, 0.1, 0, 0.22, 0.5, 0.8)]
for i in range(6):
    a = TAU * i / 6
    fl.append(sphere(0.38 * math.cos(a), 0, 0.38 * math.sin(a), 0.2, 1.0, 0.4))
finish(join(fl, 'flower'), 'flower')

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True, export_yup=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False)
print('wrote', OUT)
