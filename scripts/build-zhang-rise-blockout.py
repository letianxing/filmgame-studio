"""Fresh Blender-only spatial reference for north-seat rising; no final character art."""
import bpy,json,sys,math
from pathlib import Path
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view
if '--background' not in sys.argv or '--factory-startup' not in sys.argv:raise ValueError('Fresh background Blender required')
source,out=map(lambda s:Path(s).resolve(),sys.argv[sys.argv.index('--')+1:]);out.mkdir(parents=True,exist_ok=True)
if (out/'zhang-rise-blockout.blend').exists():raise ValueError('Refusing scene overwrite')
layout=json.loads(source.read_text())
for o in tuple(bpy.data.objects):bpy.data.objects.remove(o,do_unlink=True)
def material(name,color):
 m=bpy.data.materials.new(name);m.diffuse_color=(*color,1);return m
wood=material('dark timber',(.18,.10,.055));floor=material('wood floor',(.35,.24,.14));mat=material('straw mat',(.58,.44,.25));screen=material('woven screen',(.58,.48,.34));body=material('host robe proxy',(.34,.12,.07));skin=material('head and hand proxy',(.64,.43,.29));dark=material('cloth footwear and cap',(.07,.065,.06))
def world(point):return (point[0],-point[1],point[2])
def box(name,location,size,material):
 bpy.ops.mesh.primitive_cube_add(size=1,location=world(location));o=bpy.context.object;o.name=name;o.dimensions=size;o.data.materials.append(material);return o
def ellipsoid(name,location,size,material):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,radius=1,location=world(location));o=bpy.context.object;o.name=name;o.scale=size;o.data.materials.append(material);return o
def limb(name,a,b,radius,material):
 a,b=Vector(world(a)),Vector(world(b));direction=b-a;bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=radius,depth=direction.length,location=(a+b)/2);o=bpy.context.object;o.name=name;o.rotation_euler=direction.to_track_quat('Z','Y').to_euler();o.data.materials.append(material)
box('floor',(5,3,-.06),(10,6,.12),floor)
for x in [2.8,5,7.2]:
 box('north woven screen',(x,.15,1.3),(2.05,.07,2.6),screen)
 for dx in [-1.025,1.025]:box('screen upright',(x+dx,.13,1.3),(.045,.09,2.6),wood)
 box('screen top',(x,.13,2.6),(2.1,.09,.045),wood)
for seat in layout['seats'][:3]:
 x,y=seat['xy'];box('mat-'+seat['id'],(x,y,.025),(1.4,1.2,.05),mat)
for table in layout['tables'][:3]:
 x,y=table['center'];w,d=table['size'];box(table['id'],(x,y,.34),(w,d,.08),wood)
 for dx in [-w*.39,w*.39]:
  for dy in [-d*.32,d*.32]:box(table['id']+' leg',(x+dx,y+dy,.16),(.06,.06,.32),wood)
hip=(4.65,1.9,.58);shoulder=(4.65,1.9,1.08);left_knee=(4.25,2.15,.49);left_ankle=(4.1,2.15,.10);right_knee=(4.7,1.78,.09);right_ankle=(4.8,1.3,.09)
ellipsoid('torso',(.5*(hip[0]+shoulder[0]),1.9,.83),(.22,.15,.32),body)
ellipsoid('head',(4.65,1.9,1.28),(.13,.12,.17),skin);box('rectangular cap',(4.65,1.9,1.47),(.29,.25,.20),dark)
for label,knee,ankle in [('support',left_knee,left_ankle),('kneeling',right_knee,right_ankle)]:
 limb(label+' thigh',hip,knee,.10,body);limb(label+' shin',knee,ankle,.075,body);ellipsoid(label+' foot',(ankle[0],ankle[1]+.07,.08),(.075,.16,.06),dark)
for label,start,elbow,hand in [('left',(4.43,1.9,1.05),(4.28,2.03,.76),(4.25,2.14,.55)),('right',(4.87,1.9,1.05),(4.91,2.03,.83),(4.72,2.10,.72))]:
 limb(label+' upper arm',start,elbow,.065,body);limb(label+' forearm',elbow,hand,.055,body);ellipsoid(label+' hand',hand,(.065,.05,.04),skin)
scene=bpy.context.scene;scene.render.resolution_x=1600;scene.render.resolution_y=900;scene.render.resolution_percentage=100
bpy.ops.object.camera_add(location=world((1.6,3.8,1.35)));cam=bpy.context.object;target=Vector(world((4.7,1.9,.95)));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=32;scene.camera=cam
points=[Vector(world(v)) for v in [(4.65,1.9,1.95),(4.1,2.22,.02),(4.8,1.3,.02)]]
for _ in range(12):
 bpy.context.view_layer.update();projected=[world_to_camera_view(scene,cam,p) for p in points]
 if all(.05<p.x<.95 and .05<p.y<.95 for p in projected):break
 cam.location=target+(cam.location-target)*1.06
else:raise ValueError('Standing envelope outside camera')
scene.render.engine='BLENDER_WORKBENCH';scene.display.shading.light='STUDIO';scene.display.shading.color_type='MATERIAL';scene.display.shading.show_shadows=True;scene.display.shading.show_cavity=True
scene.render.threads_mode='FIXED';scene.render.threads=2;scene.render.filepath=str(out/'zhang-rise-blockout.png')
bpy.ops.wm.save_as_mainfile(filepath=str(out/'zhang-rise-blockout.blend'));bpy.ops.render.render(write_still=True)
(out/'verification.json').write_text(json.dumps({'status':'SPATIAL_PROXY_NOT_FINAL_ART','source':str(source),'north':'layout y0','coordinateConvention':'Blender Y is negative layout Y, preserving east/west and north-facing shot handedness','hostSeat':[5,1.8],'supportFoot':left_ankle,'kneelingKnee':right_knee,'deskFootprint':{'x':[4.5,5.5],'y':[2.45,3.05]},'supportFootOutsideDesk':True,'camera':list(cam.location),'standingEnvelopeScreen':[[p.x,p.y]for p in projected],'limitations':['proxy anatomy, not final robes','no historical footwear certification','no dynamic collision validation yet']},indent=2))
