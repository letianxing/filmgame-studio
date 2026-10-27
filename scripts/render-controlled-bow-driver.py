"""Deterministic single-character motion reference, not final character footage."""
import bpy,sys,math,json
from pathlib import Path
from mathutils import Vector,Matrix
from bpy_extras.object_utils import world_to_camera_view
if '--background' not in sys.argv or '--factory-startup' not in sys.argv:raise ValueError('Fresh background Blender only')
source,out=map(lambda x:Path(x).resolve(),sys.argv[sys.argv.index('--')+1:]);out.mkdir(exist_ok=False)
bpy.ops.wm.open_mainfile(filepath=str(source))
for obj in tuple(bpy.data.objects):
    if obj.name.startswith(('Zhang Zhao','Lu Su')):bpy.data.objects.remove(obj,do_unlink=True)
def world(x,y,z):return Vector((x,-y,z))
robe=bpy.data.materials['Kongming pale robe'];dark=bpy.data.materials['timber']
moving=[o for o in bpy.data.objects if o.name.startswith(('Kongming torso','Kongming head','Kongming nose','Kongming hand','fan'))]
def limb(name,a,b,radius):
    delta=b-a;bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=radius,depth=delta.length,location=(a+b)/2)
    obj=bpy.context.object;obj.name=name;obj.rotation_euler=delta.to_track_quat('Z','Y').to_euler();obj.data.materials.append(robe);moving.append(obj)
for side,dx in [('left',-.2),('right',.2)]:
    shoulder=world(4.6+dx,8.7,1.34);elbow=world(4.6+dx*1.1,8.55,1.12);wrist=world(4.6+dx*.6,8.46,1.1)
    limb(side+' upper sleeve',shoulder,elbow,.09);limb(side+' forearm sleeve',elbow,wrist,.075)
bpy.ops.mesh.primitive_cube_add(size=1,location=world(4.6,8.7,1.84));cap=bpy.context.object;cap.name='headcloth proxy';cap.dimensions=(.28,.25,.14);cap.data.materials.append(dark);moving.append(cap)
scene=bpy.context.scene;scene.render.resolution_x=512;scene.render.resolution_y=288;scene.render.resolution_percentage=100;scene.render.threads_mode='FIXED';scene.render.threads=2;scene.render.fps=16
initial={o.name:(o.location.copy(),o.rotation_euler.to_matrix().copy()) for o in moving};pivot=world(4.6,8.7,.9)
feet={o.name:list(o.location) for o in bpy.data.objects if o.name.startswith('Kongming foot')}
def smooth(t):return t*t*(3-2*t)
def angle(t):
    if t<.25:return 0.
    if t<1.0:return 15*smooth((t-.25)/.75)
    if t<1.25:return 15.
    if t<2.25:return 15*(1-smooth((t-1.25)/1.0))
    return 0.
rows=[];frames=out/'frames';frames.mkdir()
for i in range(49):
    degrees=angle(i/16);rotation=Matrix.Rotation(math.radians(-degrees),3,'X')
    for obj in moving:
        location,basis=initial[obj.name];obj.location=pivot+rotation@(location-pivot);obj.rotation_euler=(rotation@basis).to_euler()
    bpy.context.view_layer.update()
    for name,position in feet.items():
        if (bpy.data.objects[name].location-Vector(position)).length>1e-7:raise ValueError('Foot drift')
    head=world_to_camera_view(scene,scene.camera,bpy.data.objects['Kongming head'].location)
    rows.append({'frame':i,'seconds':i/16,'torsoDegrees':degrees,'headScreen':[head.x,head.y]})
    scene.render.filepath=str(frames/f'frame-{i:03d}.png');bpy.ops.render.render(write_still=True)
assert rows[0]['torsoDegrees']==rows[-1]['torsoDegrees']==0 and max(x['torsoDegrees'] for x in rows)==15
bpy.ops.wm.save_as_mainfile(filepath=str(out/'driver.blend'))
(out/'motion.json').write_text(json.dumps({'status':'GEOMETRIC_DRIVING_REFERENCE_NOT_FINAL_ART','frames':49,'fps':16,'maxTorsoDegrees':15,'feetFixed':True,'anatomicalRight':'positive layout X; fan attached to right hand','limitations':['proxy facial anatomy and simplified clothes','WAN transfer of this proxy remains untested','not production footage or completed greeting'],'samples':rows},indent=2)+'\n')
