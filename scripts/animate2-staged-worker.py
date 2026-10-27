"""Explicit process stages using configured Comfy APIs; no upstream source edits."""
import argparse,hashlib,json,sys
from pathlib import Path

def plain_tensors(value, path='root'):
    import torch
    if isinstance(value,torch.Tensor):
        if not torch.isfinite(value).all():raise ValueError('Non-finite conditioning: '+path)
        return value.detach().cpu().contiguous()
    if type(value).__module__=='comfy.clip_vision' and type(value).__name__=='Output':
        return {'__clip_vision_output__':plain_tensors(vars(value),path+'.clip')}
    if isinstance(value,dict):
        if not all(isinstance(k,str) for k in value):raise ValueError('Non-string metadata key')
        return {k:plain_tensors(v,path+'.'+k) for k,v in value.items()}
    if isinstance(value,(list,tuple)):
        return [plain_tensors(v,path+'.'+str(i)) for i,v in enumerate(value)]
    if value is None or type(value) in (str,int,float,bool):return value
    raise ValueError('Unsupported condition metadata at '+path+': '+type(value).__name__)

def restore_conditions(value):
    if isinstance(value,dict):
        if set(value)=={'__clip_vision_output__'}:
            from comfy.clip_vision import Output
            result=Output()
            for key,item in value['__clip_vision_output__'].items():
                if key.startswith('_'):raise ValueError('Invalid vision metadata field')
                setattr(result,key,restore_conditions(item))
            return result
        return {k:restore_conditions(v) for k,v in value.items()}
    if isinstance(value,list):return [restore_conditions(v) for v in value]
    return value

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--stage',choices=['text','visual','sample','decode'],required=True)
    parser.add_argument('--comfy-home',required=True);parser.add_argument('--model-root',required=True)
    parser.add_argument('--graph',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--text-input');parser.add_argument('--input-root')
    parser.add_argument('--visual-input')
    parser.add_argument('--sample-input')
    parser.add_argument('--attention',choices=['split','pytorch'],default='split')
    args=parser.parse_args();out=Path(args.output).resolve()
    if out.exists():raise ValueError('Refusing existing stage output')
    graph_path=Path(args.graph);graph=json.loads(graph_path.read_text())
    sys.path.insert(0,str(Path(args.comfy_home).resolve()))
    attention_flag='--use-pytorch-cross-attention' if args.attention=='pytorch' else '--use-split-cross-attention'
    sys.argv=[sys.argv[0],'--fp16-text-enc','--fp16-unet','--cpu-vae','--fp32-vae',attention_flag]
    import comfy.options
    comfy.options.enable_args_parsing()
    import torch,folder_paths,nodes
    torch.set_num_threads(2)
    for category in ['text_encoders','vae','clip_vision','diffusion_models','loras']:
        folder_paths.add_model_folder_path(category,str(Path(args.model_root).resolve()/category),is_default=True)
    conditions={}
    digest=hashlib.sha256(graph_path.read_bytes()).hexdigest()
    if args.stage=='text':
        clip=nodes.CLIPLoader().load_clip(graph['4']['inputs']['clip_name'],type='wan',device='cpu')[0]
        with torch.inference_mode():
            for name,key in [('positive','5'),('negative','6'),('positive_pose','7')]:
                conditions[name]=plain_tensors(nodes.CLIPTextEncode().encode(clip,graph[key]['inputs']['text'])[0])
                print('Encoded '+name,flush=True)
        payload={'schemaVersion':1,'stage':'text','graphSha256':digest,'conditions':conditions}
    elif args.stage=='visual':
        if not args.text_input or not args.input_root:raise ValueError('Visual stage requires text bundle and input root')
        prior=torch.load(args.text_input,map_location='cpu',weights_only=True)
        if prior.get('stage')!='text' or prior.get('graphSha256')!=digest:raise ValueError('Text bundle does not match graph')
        conditions=plain_tensors(prior['conditions'])
        from comfy_extras.nodes_video import LoadVideo,GetVideoComponents
        from comfy_extras.nodes_wan import WanAnimate2ToVideo
        folder_paths.set_input_directory(str(Path(args.input_root).resolve()))
        reference=nodes.LoadImage().load_image(graph['10']['inputs']['image'])[0]
        driving=GetVideoComponents.execute(LoadVideo.execute(graph['11']['inputs']['file'])[0])[0]
        config={k:v for k,v in graph['16']['inputs'].items() if not isinstance(v,list)}
        if len(driving)<config['length']:raise ValueError('Driving video too short; no held-frame padding allowed')
        driving=driving[:config['length']]
        with torch.inference_mode():
            vision=nodes.CLIPVisionLoader().load_clip(graph['9']['inputs']['clip_name'])[0]
            ref_clip=nodes.CLIPVisionEncode().encode(vision,reference,'none')[0]
            pose_clip=nodes.CLIPVisionEncode().encode(vision,driving[:1],'none')[0]
            vae=nodes.VAELoader().load_vae(graph['8']['inputs']['vae_name'])[0]
            result=WanAnimate2ToVideo.execute(positive=conditions['positive'],negative=conditions['negative'],positive_pose=conditions['positive_pose'],vae=vae,reference_image=reference,pose_video=driving,clip_vision_output=ref_clip,clip_vision_output_pose=pose_clip,**config)
        payload=plain_tensors({'schemaVersion':1,'stage':'visual','graphSha256':digest,'positive':result[0],'negative':result[1],'latent':result[2],'trimLatent':result[3],'trimImage':result[4]})
    elif args.stage=='sample':
        if not args.visual_input:raise ValueError('Sampling requires visual bundle')
        prior=torch.load(args.visual_input,map_location='cpu',weights_only=True)
        if prior.get('stage')!='visual' or prior.get('graphSha256')!=digest:raise ValueError('Visual bundle does not match graph')
        prior=restore_conditions(plain_tensors(prior))
        import comfy.model_management as mm
        if mm.get_torch_device().type!='mps':raise ValueError('Current sampling evaluation is MPS-only')
        mm.vram_state=mm.VRAMState.NO_VRAM;mm.lowvram_available=True
        from comfy_extras.nodes_model_advanced import ModelSamplingSD3
        from comfy_extras.nodes_custom_sampler import BasicScheduler,KSamplerSelect,SamplerCustom
        model=nodes.UNETLoader().load_unet(**graph['1']['inputs'])[0]
        config={k:v for k,v in graph['2']['inputs'].items() if k!='model'}
        model=nodes.LoraLoaderModelOnly().load_lora_model_only(model,**config)[0]
        model=ModelSamplingSD3().patch(model,shift=graph['3']['inputs']['shift'])[0]
        scheduler={k:v for k,v in graph['17']['inputs'].items() if k!='model'}
        sigmas=BasicScheduler.execute(model=model,**scheduler)[0]
        sampler=KSamplerSelect.execute(**graph['18']['inputs'])[0]
        config={k:v for k,v in graph['19']['inputs'].items() if not isinstance(v,list)}
        with torch.inference_mode():
            result=SamplerCustom.execute(model=model,positive=prior['positive'],negative=prior['negative'],sampler=sampler,sigmas=sigmas,latent_image=prior['latent'],**config)
        payload=plain_tensors({'schemaVersion':1,'stage':'sample','graphSha256':digest,'latent':result[0],'trimLatent':prior['trimLatent'],'trimImage':prior['trimImage']})
    else:
        if not args.sample_input:raise ValueError('Decode requires sampled latent bundle')
        prior=torch.load(args.sample_input,map_location='cpu',weights_only=True)
        if prior.get('stage')!='sample' or prior.get('graphSha256')!=digest:raise ValueError('Sample bundle does not match graph')
        plain_tensors(prior)
        from comfy_extras.nodes_wan import TrimVideoLatent
        vae=nodes.VAELoader().load_vae(graph['8']['inputs']['vae_name'])[0]
        with torch.inference_mode():
            latent=TrimVideoLatent.execute(prior['latent'],prior['trimLatent'])[0]
            frames=nodes.VAEDecode().decode(vae,latent)[0]
            frames=frames[prior['trimImage']:prior['trimImage']+graph['16']['inputs']['length']]
        if len(frames)!=graph['16']['inputs']['length']:raise ValueError('Decoded frame count mismatch')
        payload=plain_tensors({'schemaVersion':1,'stage':'decode','graphSha256':digest,'frames':frames})
        from PIL import Image
        folder=out.parent/'decoded-frames';folder.mkdir(exist_ok=False)
        for i,frame in enumerate(payload['frames']):
            Image.fromarray((frame.clamp(0,1).numpy()*255).round().astype('uint8')).save(folder/f'frame-{i:03d}.png')
    out.parent.mkdir(parents=True,exist_ok=True);partial=out.with_suffix('.partial.pt');torch.save(payload,partial)
    loaded=torch.load(partial,map_location='cpu',weights_only=True)
    plain_tensors(loaded)
    partial.replace(out)
    out.with_suffix('.receipt.json').write_text(json.dumps({'stage':args.stage,'attention':args.attention,'graphSha256':payload['graphSha256'],'bytes':out.stat().st_size,'status':'FINITE_CONDITIONS_SERIALIZED_PROCESS_EXIT_REQUIRED'},indent=2)+'\n')
    print(args.stage+' stage saved; process exit releases encoders',flush=True)

if __name__=='__main__':main()
