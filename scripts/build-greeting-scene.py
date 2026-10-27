"""Shared-scene geometry/lighting preview, never final character artwork.

Fresh Blender only. Exports three rendered states and world/screen anchors.
"""
import bpy,json,math,sys
from pathlib import Path
from mathutils import Vector,Matrix
from bpy_extras.object_utils import world_to_camera_view

if '--background' not in sys.argv or '--factory-startup' not in sys.argv:
    raise ValueError('Fresh background Blender required')
contract,out=map(Path,sys.argv[sys.argv.index('--')+1:]);d=json.loads(contract.read_text());out.mkdir(parents=True,exist_ok=False)
layout=json.loads(Path(d['layoutSource']).read_text())
for obj in tuple(bpy.data.objects):bpy.data.objects.remove(obj,do_unlink=True)
def world(v):return Vector((v[0],-v[1],v[2]))
def material(name,color):
    m=bpy.data.materials.new(name);m.use_nodes=True
    shader=m.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=(*color,1);shader.inputs['Roughness'].default_value=.8
    return m
wood=material('timber',(.24,.14,.07));floor=material('floor',(.36,.26,.17));wall=material('wall',(.30,.27,.22));skin=material('proxy skin',(.57,.36,.22));dark=material('shoes and headcloth',(.045,.04,.035));ivory=material('guest robe',(.65,.63,.54));brown=material('host robe',(.26,.12,.075));grey=material('seated proxies',(.18,.22,.23));feathers=material('fan feathers',(.73,.72,.65))
def box(name,location,size,mat):
    bpy.ops.mesh.primitive_cube_add(size=1,location=world(location));o=bpy.context.object;o.name=name;o.dimensions=size;o.data.materials.append(mat);return o
def oval(name,location,size,mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=1,location=world(location));o=bpy.context.object;o.name=name;o.scale=size;o.data.materials.append(mat);return o
def parent(obj,owner):
    bpy.context.view_layer.update();matrix=obj.matrix_world.copy();obj.parent=owner;obj.matrix_world=matrix
def link(name,start,end,radius,mat,owner):
    p1,p2=world(start),world(end);delta=p2-p1
    bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=radius,depth=delta.length,location=(p1+p2)/2)
    o=bpy.context.object;o.name=name;o.rotation_euler=delta.to_track_quat('Z','Y').to_euler();o.data.materials.append(mat);parent(o,owner);return o
def draped_sleeve(name,start,end,mat,owner):
    # Asymmetric fabric volume: small arm clearance above, broad hanging cloth
    # below. This preserves wide-sleeve mass without a thick circular tube.
    a,b=world(start),world(end);axis=(b-a).normalized();down=Vector((0,0,-1))
    down=(down-axis*down.dot(axis)).normalized();side=axis.cross(down).normalized()
    vertices=[];segments=16
    for index,t in enumerate([0,.35,.7,1]):
        center=a.lerp(b,t);width=[.06,.095,.115,.105][index];hang=[.07,.16,.23,.20][index]
        for j in range(segments):
            angle=2*math.pi*j/segments;s=math.sin(angle)
            vertices.append(center+side*(math.cos(angle)*width)+down*(s*(hang if s>0 else .035)))
    faces=[]
    for ring in range(3):
        for j in range(segments):
            k=(j+1)%segments;faces.append((ring*segments+j,ring*segments+k,(ring+1)*segments+k,(ring+1)*segments+j))
    faces.extend([tuple(reversed(range(segments))),tuple(range(3*segments,4*segments))])
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);obj.data.materials.append(mat);parent(obj,owner)
    return obj
box('floor',(5,5.5,-.05),(10,11,.1),floor)
box('east wall',(10,5.5,1.8),(.12,11,3.6),wall);box('north wall',(5,0,1.8),(10,.12,3.6),wall)
for y in [1,4,7,10]:box('east column',(9.5,y,1.8),(.22,.22,3.6),wood)
for x in [1,3,5,7,9]:box('north screen post',(x,.4,1.3),(.08,.08,2.6),wood)
for table in layout['tables']:
    x,y=table['center'];w,h=table['size'];box(table['id'],(x,y,.34),(w,h,.08),wood)
    for dx in [-w*.35,w*.35]:
        for dy in [-h*.35,h*.35]:box(table['id']+' leg',(x+dx,y+dy,.15),(.06,.06,.30),wood)
for seat in layout['seats']:
    if seat['id'] in ['kongming','zhang-zhao','lu-su']:continue
    x,y=seat['xy'];oval(seat['id']+' seated robe',(x,y,.45),(.24,.22,.42),grey);oval(seat['id']+' seated head',(x,y,1.03),(.13,.12,.17),skin)
rigs={};anchors={};head_rigs={}
for actor in d['actors']:
    name=actor['id'];x,y,_=actor['root'];height=actor['height'];direction=actor['facing'][1];hip=height*.52;mat=ivory if name=='kongming' else brown
    yaw=math.radians(-direction*actor.get('torsoOpenTowardCameraDegrees',0))
    for dx in [-.14,.14]:
        shoe=box(name+' shoe',(x+dx,y+direction*.06,.045),(.14,.29,.09),dark)
        origin=world((x,y,0));shoe.location=origin+Matrix.Rotation(yaw,3,'Z')@(shoe.location-origin);shoe.rotation_euler.z=yaw
    lower=oval(name+' lower robe',(x,y,.47),(.25,.21,.46),mat);lower.rotation_euler.z=yaw
    rig=bpy.data.objects.new(name+' hip pivot',None);bpy.context.collection.objects.link(rig);rig.location=world((x,y,hip));rigs[name]=rig
    parts=[oval(name+' upper robe',(x,y,hip+.25),(.25,.18,.31),mat),oval(name+' head',(x,y,height-.15),(.135,.12,.17),skin),oval(name+' nose',(x,y+direction*.115,height-.15),(.035,.045,.035),skin),box(name+' headcloth',(x,y,height-.005),(.25,.22,.10),dark)]
    if actor.get('headclothProxy')=='fitted-cloth-v1':
        bpy.data.objects.remove(parts[-1],do_unlink=True)
        cloth=oval(name+' headcloth',(x,y-direction*.025,height-.055),(.125,.125,.105),dark)
        cloth.rotation_euler.x=math.radians(direction*18)
        parts[-1]=cloth
    right=[x-direction*.08,y+direction*.23,1.0];left=[x-direction*.02,y+direction*.27,1.02]
    if 'rightGripLayoutOffset' in actor:
        right=[actor['root'][i]+v for i,v in enumerate(actor['rightGripLayoutOffset'])]
        left=[right[i]+v for i,v in enumerate(actor['leftPalmFromRightOffset'])]
    hands=[oval(name+' anatomical right grip',right,(.055,.045,.045),skin),oval(name+' supporting left palm',left,(.055,.04,.045),skin)]
    for obj in parts+hands:parent(obj,rig)
    head_pivot=bpy.data.objects.new(name+' independent head pivot',None);bpy.context.collection.objects.link(head_pivot);head_pivot.location=parts[1].matrix_world.translation.copy();parent(head_pivot,rig)
    for obj in parts[1:]:parent(obj,head_pivot)
    head_pivot.rotation_euler.z=-yaw
    head_rigs[name]=head_pivot
    for side,end in [(-1,left),(1,right)]:
        side *= -direction  # anatomical side follows each actor's facing
        shoulder=[x+side*.22,y,height*.82];elbow=[x+side*.25,y+direction*.11,height*.63]
        if actor.get('sleeveProxy')=='draped-v1':
            draped_sleeve(name+' upper sleeve',shoulder,elbow,mat,rig);draped_sleeve(name+' fore sleeve',elbow,end,mat,rig)
        else:
            link(name+' upper sleeve',shoulder,elbow,actor.get('upperSleeveProxyRadius',.095),mat,rig);link(name+' fore sleeve',elbow,end,actor.get('foreSleeveProxyRadius',.075),mat,rig)
    anchors[name]={'head':parts[1],'nose':parts[2],'rightGrip':hands[0],'leftPalm':hands[1]}
    if name=='kongming':
        fan_yaw=math.radians(d['prop'].get('yawRelativeTorsoDegrees',0))
        handle=box('single fan handle',right,(.022,.022,.22),wood);handle.rotation_euler.z=fan_yaw;parent(handle,hands[0])
        # One connected fan assembly, explicitly parented to the right grip.
        offset=d['prop'].get('surfaceOffsetFromGrip',[0,0,.20])
        fan=oval('single feather fan',tuple(right[i]+offset[i] for i in range(3)),tuple(d['prop'].get('surfaceRadii',[.16,.025,.17])),feathers);fan.rotation_euler.z=fan_yaw;parent(fan,handle)
        if 'axisInTorsoBlender' in d['prop']:
            axis=Vector(d['prop']['axisInTorsoBlender']).normalized()
            rotation=Vector((0,0,1)).rotation_difference(axis).to_matrix().to_4x4()
            bpy.context.view_layer.update()
            pivot=hands[0].matrix_world.translation.copy()
            # Rotating the parent moves the fan surface together with its handle.
            handle.matrix_world=Matrix.Translation(pivot)@rotation@Matrix.Translation(-pivot)@handle.matrix_world
        anchors[name]['fanHandle']=handle
        anchors[name]['fanSurface']=fan
    rig.rotation_euler.z=yaw
scene=bpy.context.scene
bpy.ops.object.camera_add();camera=bpy.context.object;camera.name='contract camera';camera.data.lens=d['camera']['focalLengthMm'];camera.data.sensor_width=d['camera']['sensorWidthMm'];scene.camera=camera
bpy.ops.object.light_add(type='AREA',location=world((.1,6.8,2.8)));light=bpy.context.object;light.name='west window daylight';light.data.energy=1600;light.data.shape='RECTANGLE';light.data.size=5;light.data.size_y=2
light.rotation_euler=(world((5,7,1))-light.location).to_track_quat('-Z','Y').to_euler()
scene.world.color=(.12,.12,.12);scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=16
scene.render.threads_mode='FIXED';scene.render.threads=2;scene.render.resolution_x=960;scene.render.resolution_y=540;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.fps=d['fps'];scene.frame_start=0;scene.frame_end=d['frames']-1
records=[]
for frame in range(d['frames']):
    t=frame/(d['frames']-1);start=Vector(d['camera']['positionStart']);end=Vector(d['camera']['positionEnd']);camera.location=world(start.lerp(end,t));camera.rotation_euler=(world(d['camera']['target'])-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.keyframe_insert('location',frame=frame);camera.keyframe_insert('rotation_euler',frame=frame)
    for actor in d['actors']:
        angle=0
        for left,right in zip(actor.get('bowKeys',[]),actor.get('bowKeys',[])[1:]):
            if left['frame']<=frame<=right['frame']:
                u=(frame-left['frame'])/(right['frame']-left['frame']);u=u*u*(3-2*u);angle=left['degrees']*(1-u)+right['degrees']*u;break
        # Positive bow angles lean toward the actor's facing direction. The
        # opposing host must not inherit the guest's negative-X rotation.
        direction=actor['facing'][1]
        if direction not in (-1,1):raise ValueError('Greeting rig requires north/south facing')
        rig=rigs[actor['id']]
        if actor.get('bowPlane')=='partner':
            # World-space lean must not rotate with the opened torso. Keep
            # costume/shoulder yaw, but bow along the partner-to-partner axis.
            target=next(v for v in d['actors'] if v['id']==actor['gazeTarget'].split('.')[0])
            forward=world(target['root'])-world(actor['root']);forward.z=0;forward.normalize()
            axis=Vector((0,0,1)).cross(forward)
            yaw=math.radians(-direction*actor.get('torsoOpenTowardCameraDegrees',0))
            rig.rotation_euler=(Matrix.Rotation(math.radians(angle),3,axis)@Matrix.Rotation(yaw,3,'Z')).to_euler()
        else:rig.rotation_euler.x=math.radians(direction*angle)
        rig.keyframe_insert('rotation_euler',frame=frame)
    bpy.context.view_layer.update()
    for actor in d['actors']:
        if actor.get('headAimPolicy')!='partner-head':continue
        pivot=head_rigs[actor['id']];target_id=actor['gazeTarget'].split('.')[0]
        location=pivot.matrix_world.translation.copy()
        forward=anchors[target_id]['head'].matrix_world.translation-location
        track='-Y' if actor['facing'][1]>0 else 'Y'
        pivot.matrix_world=Matrix.Translation(location)@forward.to_track_quat(track,'Z').to_matrix().to_4x4()
        pivot.keyframe_insert('rotation_euler',frame=frame)
    bpy.context.view_layer.update();row={'frame':frame,'anchors':{}}
    for name,items in anchors.items():
        actor=next(v for v in d['actors'] if v['id']==name)
        expected=actor['height']-.15-actor['height']*.52
        actual=(items['head'].matrix_world.translation-rigs[name].matrix_world.translation).length
        if abs(actual-expected)>1e-5:raise ValueError('Head pivot detached from torso hierarchy')
        row['anchors'][name]={key:{'world':list(obj.matrix_world.translation),'screen':list(world_to_camera_view(scene,camera,obj.matrix_world.translation))} for key,obj in items.items()}
    distance=(anchors['kongming']['fanHandle'].matrix_world.translation-anchors['kongming']['rightGrip'].matrix_world.translation).length
    if distance>1e-5:raise ValueError('Fan detached from right hand')
    fan_points=[fan.matrix_world@Vector(v) for v in fan.bound_box]
    clearance=min((v-anchors['kongming']['head'].matrix_world.translation).length for v in fan_points)-.17
    if clearance<.04:raise ValueError('Fan/head proxy clearance too small')
    projected=[world_to_camera_view(scene,camera,v) for v in fan_points]
    row['fanGripDistanceMeters']=distance;row['fanHeadProxyClearanceMeters']=clearance;row['fanScreenBounds']=[min(v.x for v in projected),min(v.y for v in projected),max(v.x for v in projected),max(v.y for v in projected)];records.append(row)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'greeting-scene.blend'))
for frame in [0,24,48]:
    scene.frame_set(frame);scene.render.filepath=str(out/f'frame-{frame:03d}.png');bpy.ops.render.render(write_still=True)
(out/'anchors.json').write_text(json.dumps({'status':'PROXY_SCENE_REVIEW_REQUIRED','contract':str(contract),'samples':records,'limitations':['Proxy anatomy and garments; no final identity or finger/cloth certification.','Seated extras are anonymous occlusion proxies.','No WAN control input is approved by this output.']},indent=2)+'\n')
