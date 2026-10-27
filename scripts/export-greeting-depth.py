"""Render a shared camera's normalized view-depth control sequence in Blender.

Shader view depth avoids color/texture proxy leakage. This is a control signal,
not a claim of calibrated depth for the generated appearance reference.
"""
import bpy,json,sys
from pathlib import Path
if '--background' not in sys.argv or '--factory-startup' not in sys.argv:raise ValueError('Fresh background Blender required')
arguments=sys.argv[sys.argv.index('--')+1:]
source,contract,out=map(Path,arguments[:3]);width,height=map(int,arguments[3:]) if len(arguments)==5 else (512,288)
if (width,height) not in [(512,288),(768,448)]:raise ValueError('Unsupported bounded render size')
d=json.loads(contract.read_text());out.mkdir(parents=True,exist_ok=False)
bpy.ops.wm.open_mainfile(filepath=str(source.resolve()));scene=bpy.context.scene
material=bpy.data.materials.new('normalized view depth control');material.use_nodes=True;nodes=material.node_tree.nodes;nodes.clear()
camera=nodes.new('ShaderNodeCameraData');mapping=nodes.new('ShaderNodeMapRange');emission=nodes.new('ShaderNodeEmission');output=nodes.new('ShaderNodeOutputMaterial')
mapping.inputs['From Min'].default_value=.5;mapping.inputs['From Max'].default_value=12;mapping.inputs['To Min'].default_value=1;mapping.inputs['To Max'].default_value=0;mapping.clamp=True
links=material.node_tree.links;links.new(camera.outputs['View Z Depth'],mapping.inputs['Value']);links.new(mapping.outputs['Result'],emission.inputs['Color']);links.new(emission.outputs[0],output.inputs['Surface'])
scene.view_layers[0].material_override=material;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=1;scene.cycles.use_denoising=False
scene.render.resolution_x=width;scene.render.resolution_y=height;scene.render.resolution_percentage=100;scene.render.threads_mode='FIXED';scene.render.threads=2
if (width,height)==(768,448):
    # Render a 16:9 image first; pad in separate preparation to avoid changing camera FOV.
    scene.render.resolution_y=432
scene.view_settings.view_transform='Raw';scene.view_settings.exposure=0;scene.view_settings.gamma=1
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB';scene.render.image_settings.color_depth='8'
for frame in range(d['frames']):
    scene.frame_set(frame);scene.render.filepath=str(out/f'depth-{frame:03d}.png');bpy.ops.render.render(write_still=True)
    if frame%8==0:print(f'Depth {frame+1}/{d["frames"]}',flush=True)
(out/'manifest.json').write_text(json.dumps({'status':'CONTROL_SEQUENCE_REQUIRES_ALIGNMENT_AND_MEDIA_REVIEW','sourceScene':str(source),'contract':str(contract),'frames':d['frames'],'fps':d['fps'],'size':[scene.render.resolution_x,scene.render.resolution_y],'encoding':'Shared-camera View Z Depth mapped near .5m white to far 12m black, Raw view transform, RGB8 PNG','limitations':['Proxy geometry and generated reference are not pixel-exact.','Single-sample edges can alias.','No final appearance or control-following acceptance.']},indent=2)+'\n')
