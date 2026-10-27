"""Guarded Wan2.2-Fun Control stages using installed Comfy public nodes."""
import argparse,hashlib,importlib.util,json,os,sys
from pathlib import Path


def main():
    p=argparse.ArgumentParser();p.add_argument('request');p.add_argument('--stage',choices=['text','visual','sample','decode'],required=True);p.add_argument('--input');p.add_argument('--output',required=True);p.add_argument('--execute',action='store_true')
    p.add_argument('--spatial-tiled-decode',action='store_true');p.add_argument('--decode-first-latent',action='store_true');p.add_argument('--png-only',action='store_true');a=p.parse_args()
    if a.png_only and a.stage!='decode':raise ValueError('PNG-only storage requires decode stage')
    if (a.spatial_tiled_decode or a.decode_first_latent) and a.stage!='decode':raise ValueError('Decode options only apply to decode stage')
    raw=Path(a.request).read_bytes();d=json.loads(raw);digest=hashlib.sha256(raw).hexdigest();out=Path(a.output)
    if out.exists() or out.with_suffix('.partial.pt').exists():raise ValueError('Stage output exists')
    allowed_frames=[49]
    if d.get('purpose')=='registered-static-control-isolation':allowed_frames.append(17)
    sizes=[(512,288)]
    if d.get('purpose') in ('native-resolution-quality-comparison','scene-shot-candidate'):sizes.append((768,448))
    if (d['width'],d['height']) not in sizes or d['frames'] not in allowed_frames:raise ValueError('Only reviewed bounded evaluation profile supported')
    if not a.execute:
        from media_resource_guard import bounded_media
        os.environ.update(HF_HUB_OFFLINE='1',OMP_NUM_THREADS='2',PYTORCH_ENABLE_MPS_FALLBACK='0',PYTORCH_MPS_HIGH_WATERMARK_RATIO='0.4',PYTORCH_MPS_LOW_WATERMARK_RATIO='0.3')
        out.parent.mkdir(parents=True,exist_ok=True);stats=None
        try:
            with bounded_media([sys.executable,__file__,*sys.argv[1:],'--execute'],out.parent,max_rss_mb=24576,min_free_gb=20,minimum_available_gb=8,max_swap_growth_gb=1,timeout=1800) as(proc,stats):proc.wait()
        finally:
            if stats is not None:out.with_suffix('.resources.json').write_text(json.dumps(stats,indent=2)+'\n')
        return
    sys.path[:0]=[str(Path(d['dependencies']).resolve()),str(Path(d['comfyHome']).resolve())]
    sys.argv=['wan-fun-stage','--fp16-text-enc','--fp16-unet','--cpu-vae','--fp32-vae','--use-pytorch-cross-attention']
    import comfy.options
    comfy.options.enable_args_parsing()
    import torch,nodes,folder_paths
    torch.set_num_threads(2)
    for category in ['text_encoders','vae','diffusion_models','unet']:
        location='diffusion_models' if category=='unet' else category
        folder_paths.add_model_folder_path(category,str(Path(d['modelRoot']).resolve()/location),is_default=True)
    spec=importlib.util.spec_from_file_location('animate_helpers',Path(__file__).with_name('animate2-staged-worker.py'));helpers=importlib.util.module_from_spec(spec);spec.loader.exec_module(helpers)
    payload={'stage':a.stage,'requestSha256':digest}
    if a.stage!='text':
        if not a.input:raise ValueError('Previous stage required')
        prior=torch.load(a.input,map_location='cpu',weights_only=True)
        expected={'visual':'text','sample':'visual','decode':'sample'}[a.stage]
        if prior.get('requestSha256')!=digest or prior.get('stage')!=expected:raise ValueError('Stage provenance mismatch')
    with torch.inference_mode():
        if a.stage=='text':
            clip=nodes.CLIPLoader().load_clip(d['textEncoder'],type='wan',device='cpu')[0]
            for name in ['positive','negative']:
                payload[name]=nodes.CLIPTextEncode().encode(clip,d[name])[0];print('Encoded '+name,flush=True)
        elif a.stage=='visual':
            import numpy as np
            from PIL import Image
            from comfy_extras.nodes_wan import Wan22FunControlToVideo
            reference=Path(d['reference'])
            if hashlib.sha256(reference.read_bytes()).hexdigest()!=d['referenceSha256']:raise ValueError('Reference changed')
            reference=torch.from_numpy(np.array(Image.open(reference).convert('RGB')).astype(np.float32)/255)[None]
            frames=[]
            for i,expected_hash in enumerate(d['controlSha256']):
                path=Path(d['controlDirectory'])/f'{d.get("controlPrefix","depth")}-{i:03d}.png'
                if hashlib.sha256(path.read_bytes()).hexdigest()!=expected_hash:raise ValueError('Control frame changed')
                pixels=np.array(Image.open(path).convert('RGB'))
                if pixels.shape!=(d['height'],d['width'],3):raise ValueError('Control frame size mismatch')
                frames.append(torch.from_numpy(pixels.astype(np.float32)/255))
            if len(frames)!=d['frames']:raise ValueError('Missing real control frames; no padding')
            vae=nodes.VAELoader().load_vae(d['vae'])[0]
            if vae.latent_channels!=48:raise ValueError('Expected Wan2.2 VAE')
            result=Wan22FunControlToVideo.execute(positive=prior['positive'],negative=prior['negative'],vae=vae,width=d['width'],height=d['height'],length=d['frames'],batch_size=1,ref_image=reference,start_image=reference,control_video=torch.stack(frames))
            payload.update(positive=result[0],negative=result[1],latent=result[2])
            if d.get('firstFramePolicy')=='wan22-inpaint-v1':
                from wan22_first_frame import anchor_first_frame
                import comfy.utils
                resized=comfy.utils.common_upscale(reference.movedim(-1,1),d['width'],d['height'],'bilinear','center').movedim(1,-1)
                # Upstream masks AFTER [-1,1] normalization: unknown frames
                # become zero there, corresponding to 0.5 in Comfy pixel space.
                masked_pixels=torch.full((d['frames'],d['height'],d['width'],3),.5,dtype=reference.dtype)
                masked_pixels[:1]=resized
                masked_latents=vae.encode(masked_pixels)
                for key in ['positive','negative']:
                    for _,metadata in payload[key]:
                        packed=metadata['concat_latent_image'].clone()
                        packed[:,48:]=masked_latents
                        metadata['concat_latent_image']=packed
                payload['latent']=anchor_first_frame(payload['latent'],masked_latents[:,:,:1])
        elif a.stage=='sample':
            from wan_reference_contract import validate_single_reference_conditions
            payload['referenceContract']=validate_single_reference_conditions(prior)
            import comfy.model_management as mm
            from comfy_extras.nodes_model_advanced import ModelSamplingSD3
            from comfy_extras.nodes_custom_sampler import BasicScheduler,KSamplerSelect,SamplerCustom
            root=Path(d['ggufHome']).resolve();spec=importlib.util.spec_from_file_location('filmgame_gguf',root/'__init__.py',submodule_search_locations=[str(root)]);module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
            model=module.NODE_CLASS_MAPPINGS['UnetLoaderGGUF']().load_unet(d['model'],dequant_dtype='float16',patch_dtype='float16')[0]
            if model.model.model_config.unet_config.get('in_dim')!=148:raise ValueError('Wrong control model')
            model=ModelSamplingSD3().patch(model,shift=d['shift'])[0]
            if d.get('scheduleMode')=='videox-flow-5b':
                sys.path.insert(0,str(Path(d['samplerDependencies']).resolve()))
                from diffusers import FlowMatchEulerDiscreteScheduler
                flow=FlowMatchEulerDiscreteScheduler(num_train_timesteps=1000,shift=5.0,use_dynamic_shifting=False,base_shift=.5,max_shift=1.15,base_image_seq_len=256,max_image_seq_len=4096)
                flow.set_timesteps(d['steps'],device='cpu',mu=1)
                sigmas=flow.sigmas
                if len(sigmas)!=d['steps']+1 or sigmas[-1]!=0 or not torch.all(sigmas[:-1]>=sigmas[1:]):raise ValueError('Invalid flow schedule')
            else:
                sigmas=BasicScheduler.execute(model=model,scheduler='simple',steps=d['steps'],denoise=1.0)[0]
            sampler=KSamplerSelect.execute(sampler_name='euler')[0]
            from contextlib import nullcontext
            from wan22_reference_timesteps import align_reference_timesteps
            scope=align_reference_timesteps(model.model) if d.get('referenceTimestepPolicy')=='prepend-reference-v1' else nullcontext({})
            with scope as timestep_stats:
                result=SamplerCustom.execute(model=model,add_noise=True,noise_seed=d['seed'],cfg=d['cfg'],positive=prior['positive'],negative=prior['negative'],sampler=sampler,sigmas=sigmas,latent_image=prior['latent'])
            payload['referenceTimestepStats']=timestep_stats
            payload['latent']=result[0]
        else:
            from PIL import Image
            vae=nodes.VAELoader().load_vae(d['vae'])[0]
            latent=prior['latent']
            if a.decode_first_latent:latent={**latent,'samples':latent['samples'][:,:,:1]}
            if a.spatial_tiled_decode:
                frames=nodes.VAEDecodeTiled().decode(vae,latent,tile_size=384,overlap=96,temporal_size=64,temporal_overlap=8)[0]
            else:frames=nodes.VAEDecode().decode(vae,latent)[0]
            if len(frames)!=(1 if a.decode_first_latent else d['frames']):raise ValueError('Frame count mismatch')
            payload['decodeMode']='spatial-384-overlap96' if a.spatial_tiled_decode else 'full'
            payload['firstLatentDiagnostic']=a.decode_first_latent
            if not a.png_only:payload['frames']=frames
            folder=out.parent/(out.stem+'-frames' if a.decode_first_latent else 'decoded-frames');folder.mkdir(exist_ok=False)
            for i,frame in enumerate(frames):Image.fromarray((frame.cpu().clamp(0,1).numpy()*255).round().astype('uint8')).save(folder/f'frame-{i:03d}.png')
            if a.png_only:
                payload['frameStorage']='png-only';payload['frameDirectory']=str(folder)
                payload['frameSha256']=[hashlib.sha256((folder/f'frame-{i:03d}.png').read_bytes()).hexdigest() for i in range(len(frames))]
    payload=helpers.plain_tensors(payload);partial=out.with_suffix('.partial.pt');torch.save(payload,partial);partial.replace(out)
    out.with_suffix('.receipt.json').write_text(json.dumps({'status':'STAGE_COMPLETE_NOT_QUALITY_APPROVAL','stage':a.stage,'requestSha256':digest},indent=2)+'\n');print('Complete '+a.stage,flush=True)


if __name__=='__main__':main()
