"""Fresh geometric side-view staging reference; not final film art."""
import bpy,sys,json,math
from pathlib import Path
from mathutils import Vector,Matrix
from bpy_extras.object_utils import world_to_camera_view
if '--background' not in sys.argv or '--factory-startup' not in sys.argv:raise ValueError('Fresh background Blender required')
source,out=map(Path,sys.argv[sys.argv.index('--')+1:]);out.mkdir(parents=True,exist_ok=False)
layout=json.loads(source.read_text())
for obj in tuple(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
def mat(name,color):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);return m
wood=mat('timber',(.23,.13,.06));floor=mat('floor',(.4,.3,.2));white=mat('Kongming pale robe',(.8,.78,.68));brown=mat('Zhang Zhao',(.4,.16,.09));blue=mat('Lu Su',(.16,.23,.3));skin=mat('head and hands',(.68,.47,.3));fan=mat('right hand feather fan',(.92,.91,.83))
def world(p):return Vector((p[0],-p[1],p[2]))
def box(name,p,size,m):
 bpy.ops.mesh.primitive_cube_add(size=1,location=world(p));o=bpy.context.object;o.name=name;o.dimensions=size;o.data.materials.append(m);return o
def sphere(name,p,size,m):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=1,location=world(p));o=bpy.context.object;o.name=name;o.scale=size;o.data.materials.append(m);return o
box('floor',(5,5.5,-.05),(10,11,.1),floor)
for t in layout['tables']:
 x,y=t['center'];w,d=t['size'];box(t['id'],(x,y,.34),(w,d,.08),wood)
for y in [1,4,7,10]:box('east pillar',(9.6,y,1.6),(.18,.18,3.2),wood)
scene=bpy.context.scene;moving=[]
def person(name,x,y,color,north=True):
 direction=-1 if north else 1
 sphere(name+' lower robe',(x,y,.48),(.22,.19,.46),color)
 parts=[sphere(name+' torso',(x,y,1.15),(.23,.16,.35),color),sphere(name+' head',(x,y,1.66),(.13,.12,.17),skin),sphere(name+' nose',(x,y+direction*.12,1.66),(.035,.055,.035),skin)]
 for dx in [-.14,.14]:sphere(name+' foot',(x+dx,y+direction*.06,.06),(.08,.16,.06),wood)
 for dx in [-.12,.12]:parts.append(sphere(name+' hand',(x+dx,y+direction*.24,1.10),(.07,.05,.045),skin))
 return parts
host=person('Zhang Zhao',4.6,6.6,brown,False)
moving=person('Kongming',4.6,8.7,white,True)
person('Lu Su',5.5,8.1,blue,True)
moving.append(box('fan handle RIGHT hand',(4.72,8.43,1.15),(.025,.025,.22),wood))
moving.append(sphere('fan RIGHT hand',(4.72,8.43,1.34),(.16,.025,.19),fan))
bpy.ops.object.camera_add(location=world((.8,8.0,1.25)));cam=bpy.context.object;target=world((4.7,7.75,1.0));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=32;scene.camera=cam
scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.color_type='MATERIAL';scene.display.shading.light='STUDIO';scene.display.shading.show_shadows=True;scene.render.resolution_x=1280;scene.render.resolution_y=720;scene.render.resolution_percentage=100;scene.render.threads_mode='FIXED';scene.render.threads=2
bpy.context.view_layer.update()
head0=world_to_camera_view(scene,cam,world((4.6,8.7,1.66)));hostscreen=world_to_camera_view(scene,cam,world((4.6,6.6,1.66)))
scene.render.filepath=str(out/'upright.png');bpy.ops.wm.save_as_mainfile(filepath=str(out/'side-bow.blend'));bpy.ops.render.render(write_still=True)
pivot=world((4.6,8.7,.9));rotation=Matrix.Rotation(math.radians(-15),3,'X')
for obj in moving:obj.location=pivot+rotation@(obj.location-pivot);obj.rotation_euler.rotate_axis('X',math.radians(-15))
bpy.context.view_layer.update();head1=world_to_camera_view(scene,cam,pivot+rotation@(world((4.6,8.7,1.66))-pivot))
if not hostscreen.x<head1.x<head0.x:raise ValueError('Bow must visibly approach host in screen space')
scene.render.filepath=str(out/'bow15.png');bpy.ops.render.render(write_still=True)
(out/'verification.json').write_text(json.dumps({'status':'GEOMETRIC_STAGING_REFERENCE_NOT_FINAL_ART','cameraLayout':[.8,8.0,1.25],'guestLayout':[4.6,8.7],'hostLayout':[4.6,6.6],'lusuLayout':[5.5,8.1],'guestFaces':'north / layout negative y','rightHand':'east / layout positive x','bowDegrees':15,'hostScreenX':hostscreen.x,'guestHeadStartScreenX':head0.x,'guestHeadBowScreenX':head1.x,'screenDirectionCheck':True,'limitations':['proposed staging, not yet matched to accepted entrance edit','proxy bodies and fan, no cloth or hand collision certification','camera and actors must be matched by final first frame','host walk from north seat requires coverage']},indent=2)+'\n')
