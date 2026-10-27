"""Named-object camera ray diagnostic for the proxy fan, no inference."""
import bpy,json,sys,math
from pathlib import Path
from mathutils import Vector
source,out=map(Path,sys.argv[sys.argv.index('--')+1:])
if out.exists():raise ValueError('Output exists')
bpy.ops.wm.open_mainfile(filepath=str(source.resolve()))
scene=bpy.context.scene;fan=bpy.data.objects['single feather fan'];records=[]
for frame in range(scene.frame_start,scene.frame_end+1):
    scene.frame_set(frame);bpy.context.view_layer.update();graph=bpy.context.evaluated_depsgraph_get();origin=scene.camera.matrix_world.translation
    rows=[]
    for x,z in [(0,0),(-.5,0),(.5,0),(0,.5),(0,-.5)]:
        target=fan.matrix_world@Vector((x,0,z));direction=(target-origin).normalized()
        hit,point,normal,index,obj,matrix=scene.ray_cast(graph,origin,direction,distance=(target-origin).length+.5)
        rows.append({'surfaceLocal':[x,0,z],'firstObject':obj.name if hit else None,'distanceToHit':(point-origin).length if hit else None,'distanceToFanCenterPlane':(target-origin).length})
    records.append({'frame':frame,'rays':rows,'fanWorldScale':list(fan.matrix_world.to_scale()),'fanLocalScale':list(fan.scale)})
out.write_text(json.dumps({'scene':str(source),'status':'GEOMETRY_RAY_DIAGNOSTIC','samples':records},indent=2)+'\n')
print(json.dumps({'frames':len(records),'visibleCenterFrames':sum(r['rays'][0]['firstObject']=='single feather fan' for r in records),'visibleSampleRays':sum(v['firstObject']=='single feather fan' for r in records for v in r['rays']),'totalRays':sum(len(r['rays']) for r in records)}),flush=True)
