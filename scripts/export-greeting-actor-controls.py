"""Export shared-camera actor labels and anatomical body landmarks from Blender."""
import bpy,json,math,sys
from pathlib import Path
from mathutils import Vector,Matrix
from bpy_extras.object_utils import world_to_camera_view

if '--background' not in sys.argv or '--factory-startup' not in sys.argv:raise ValueError('Fresh background Blender required')
source,contract,output=map(Path,sys.argv[sys.argv.index('--')+1:]);d=json.loads(contract.read_text());output.mkdir(parents=True,exist_ok=False)
bpy.ops.wm.open_mainfile(filepath=str(source.resolve()));scene=bpy.context.scene
width,height=512,288
scene.render.resolution_x=width;scene.render.resolution_y=height;scene.render.resolution_percentage=100
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=1;scene.cycles.use_denoising=False
scene.render.threads_mode='FIXED';scene.render.threads=2
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB';scene.render.image_settings.color_depth='8'
scene.view_settings.view_transform='Raw';scene.view_settings.exposure=0;scene.view_settings.gamma=1
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs['Color'].default_value=(0,0,0,1)
scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value=0
def emission(name,color):
    m=bpy.data.materials.new(name);m.use_nodes=True;n=m.node_tree.nodes;n.clear();e=n.new('ShaderNodeEmission');e.inputs['Color'].default_value=(*color,1);o=n.new('ShaderNodeOutputMaterial');m.node_tree.links.new(e.outputs[0],o.inputs['Surface']);return m
materials=[emission('label background',(0,0,0)),emission('label host',(1,0,0)),emission('label guest',(0,1,0))]
ids={'zhang-zhao':1,'kongming':2}
def owner(obj):
    current=obj
    while current:
        for name,index in ids.items():
            if current.name.startswith(name+' '):return index
        current=current.parent
    return 0
for obj in bpy.data.objects:
    if obj.type=='MESH':obj.data.materials.clear();obj.data.materials.append(materials[owner(obj)])
def project(point):
    p=world_to_camera_view(scene,scene.camera,point)
    return [float(p.x*width),float((1-p.y)*height),float(p.z)]
names=['nose','neck','right_shoulder','right_elbow','right_wrist','left_shoulder','left_elbow','left_wrist','right_hip','right_knee','right_ankle','left_hip','left_knee','left_ankle','right_eye','left_eye','right_ear','left_ear']
rows=[]
for frame in range(d['frames']):
    scene.frame_set(frame);bpy.context.view_layer.update();actors=[]
    for actor in d['actors']:
        name=actor['id'];h=actor['height'];direction=actor['facing'][1];hip=h*.52
        rig=bpy.data.objects[name+' hip pivot'];head=bpy.data.objects[name+' independent head pivot']
        yaw=math.radians(-direction*actor.get('torsoOpenTowardCameraDegrees',0))
        lower=Matrix.Translation(Vector((actor['root'][0],-actor['root'][1],0)))@Matrix.Rotation(yaw,4,'Z')
        def torso(x,y,z):return rig.matrix_world@Vector((x,-y,z-hip))
        def leg(x,y,z):return lower@Vector((x,-y,z))
        points={'nose':bpy.data.objects[name+' nose'].matrix_world.translation.copy(),'neck':torso(0,0,h*.85)}
        for side,sign in [('right',-direction),('left',direction)]:
            points[side+'_shoulder']=torso(sign*.22,0,h*.82)
            points[side+'_elbow']=torso(sign*.25,direction*.11,h*.63)
            points[side+'_wrist']=bpy.data.objects[name+(' anatomical right grip' if side=='right' else ' supporting left palm')].matrix_world.translation.copy()
            points[side+'_hip']=leg(sign*.14,0,hip)
            points[side+'_knee']=leg(sign*.14,direction*.03,h*.27)
            points[side+'_ankle']=leg(sign*.14,direction*.06,.12)
            points[side+'_eye']=head.matrix_world@Vector((sign*.055,-direction*.10,.035))
            points[side+'_ear']=head.matrix_world@Vector((sign*.125,0,.025))
        actors.append({'actorId':name,'labelId':ids[name],'body18':[project(points[k]) for k in names]})
    rows.append({'frame':frame,'actors':actors});scene.render.filepath=str(output/f'labels-{frame:03d}.png');bpy.ops.render.render(write_still=True)
report={'status':'PROXY_ACTOR_CONTROLS_REQUIRE_REFERENCE_ALIGNMENT','contract':str(contract),'sourceScene':str(source),'size':[width,height],'fps':d['fps'],'frames':d['frames'],'actorLabelIds':ids,'body18Order':names,'samples':rows,'productionApproved':False,'limitations':['Geometry-derived silhouettes, not segmentation of the appearance reference.','Hips/knees under robes and eye/ear points are anatomical proxies.','No face-68 or articulated hand-21 landmarks; no claim of production facial or finger control.','Seated scholars belong to background; no independent background character identity binding.']}
(output/'actor-controls.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
