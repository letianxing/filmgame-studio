"""Blender CLI-only blocking reference from the versioned seating proposal.

Run in a fresh background Blender, never in the user's unsaved scene.
Proxy figures are spatial placeholders, not character assets or historical reconstruction.
"""
import bpy,json,math,sys
from pathlib import Path
from mathutils import Vector

source,out=(Path(x).resolve() for x in sys.argv[sys.argv.index('--')+1:])
d=json.loads(source.read_text());out.mkdir(parents=True,exist_ok=True)
if (out/'hall-blockout.blend').exists():raise ValueError('Refusing existing scene overwrite')
if '--factory-startup' not in sys.argv or '--background' not in sys.argv:
    raise ValueError('Only a fresh background Blender may run this script')
for obj in tuple(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
def material(name,color):
    m=bpy.data.materials.new(name);m.use_nodes=True
    node=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    node.inputs['Base Color'].default_value=(*color,1);node.inputs['Roughness'].default_value=.85
    return m
floor=material('earth',(0.3,.27,.23));wood=material('wood',(.12,.075,.045));mat=material('woven',(.42,.33,.20))
white=material('guest',(.8,.8,.72));brown=material('host',(.35,.16,.10));grey=material('scholars',(.2,.26,.29));blue=material('route',(.03,.3,.55))
def box(name,loc,size,material):
    bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.dimensions=size;o.data.materials.append(material);return o
box('floor',(5,5.5,-.08),(10,11,.16),floor)
for x in (0,10):
    for y in (0,3.5,7,11):box(f'column-{x}-{y}',(x,y,1.5),(.22,.22,3),wood)
for seat in d['seats']:
    x,y=seat['xy'];name=seat['id'];m=white if name=='kongming' else brown if name=='zhang-zhao' else grey
    box('mat-'+name,(x,y,.025),(.9,.9,.05),mat)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=1,location=(x,y,.51))
    body=bpy.context.object;body.name='proxy-body-'+name;body.scale=(.22,.22,.42);body.data.materials.append(m)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=.14,location=(x,y,1.04))
    head=bpy.context.object;head.name='proxy-head-'+name;head.data.materials.append(m)
for table in d['tables']:
    x,y=table['center'];w,h=table['size'];box(table['id'],(x,y,.32),(w,h,.08),wood)
    for dx in (-w*.38,w*.38):
        for dy in (-h*.3,h*.3):box(table['id']+'-leg',(x+dx,y+dy,.14),(.07,.07,.28),wood)
route=d['guestRoute'];curve=bpy.data.curves.new('guest-route','CURVE');curve.dimensions='3D';curve.bevel_depth=.025
poly=curve.splines.new('POLY');poly.points.add(len(route)-1)
for point,(x,y) in zip(poly.points,route):point.co=(x,y,.075,1)
o=bpy.data.objects.new('guest-route',curve);bpy.context.collection.objects.link(o);curve.materials.append(blue)
collisions=[]
for a,b in zip(route,route[1:]):
    for i in range(101):
        t=i/100;x=a[0]*(1-t)+b[0]*t;y=a[1]*(1-t)+b[1]*t
        for table in d['tables']:
            cx,cy=table['center'];w,h=table['size']
            dx=max(abs(x-cx)-w/2,0);dy=max(abs(y-cy)-h/2,0)
            if math.hypot(dx,dy)<.4:collisions.append(table['id'])
if collisions:raise ValueError('Guest route intersects table clearance: '+str(set(collisions)))
scene=bpy.context.scene
bpy.ops.object.camera_add(location=(16,20,17));cam=bpy.context.object;cam.name='blocking-camera'
cam.rotation_euler=(Vector((5,5,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=45;scene.camera=cam
bpy.ops.object.light_add(type='AREA',location=(4,4,8));light=bpy.context.object;light.data.energy=2400;light.data.shape='DISK';light.data.size=8
scene.world.color=(.4,.4,.4)
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=8
scene.render.threads_mode='FIXED';scene.render.threads=2;scene.render.resolution_x=960;scene.render.resolution_y=640;scene.render.resolution_percentage=100
scene.render.filepath=str(out/'hall-blockout.png')
bpy.ops.wm.save_as_mainfile(filepath=str(out/'hall-blockout.blend'))
bpy.ops.render.render(write_still=True)
(out/'verification.json').write_text(json.dumps({'status':'BLOCKING_PROXY_NOT_FINAL_ART','source':str(source),
    'namedProxyCount':len(d['seats']),'guestBodyRadiusMeters':.4,'sampledTableCollisions':collisions,
    'limitations':['sampled 2D route check only','no cloth, limbs, kneeling or other-character path validation','not a historical architectural reconstruction']},indent=2))
