"""Serial, guarded LatentSync stages with first-party I/O and explicit artifacts.

Never invokes the upstream video loop/reverse or CUDA face-detector pipeline.
Outputs remain experiments pending visual, temporal and audio review.
"""
import argparse,json,os,sys,hashlib
from pathlib import Path


def load_vae(d):
    import torch
    from diffusers import AutoencoderKL
    from safetensors import safe_open
    cfg=json.loads(Path(d['vaeConfig']).read_text())['vaeConfig']
    with torch.device('meta'):model=AutoencoderKL(**{k:v for k,v in cfg.items() if not k.startswith('_')})
    weights={}
    with safe_open(str(Path(d['musetalkModels'])/'vae.safetensors'),framework='pt',device='cpu') as f:
        for key in f.keys():
            v=f.get_tensor(key)
            if key.endswith('.weight') and v.ndim==4:v=v.permute(0,3,1,2)
            weights[key]=v.contiguous().float()
    model.load_state_dict(weights,strict=True,assign=True)
    return model.eval()


def execute(a,d,digest):
    sys.path.insert(0,str(Path(d['dependencies']).resolve()))
    import torch,numpy as np
    torch.set_num_threads(2);torch.set_num_interop_threads(1)
    out=Path(a.output)
    if a.stage=='encode':
        source=np.load(d['faces']);faces=source['faces']
        audio=np.load(d['audioFeatures'])
        if faces.shape[1:]!=(512,512,3) or not 1<=len(faces)<=100 or audio.shape!=(len(faces),50,384):
            raise ValueError('Face/audio frame contract mismatch')
        mask=np.load(d['preparedMask'])
        if mask.shape!=(512,512,3):raise ValueError('Invalid prepared mask shape')
        mask=torch.from_numpy(mask.transpose(2,0,1).copy())[None]
        if (mask<0).any() or (mask>1).any():raise ValueError('Invalid mask')
        vae=load_vae(d);generator=torch.Generator().manual_seed(d['seed'])
        refs=[];masked=[]
        with torch.inference_mode():
            for i,face in enumerate(faces):
                rgb=torch.from_numpy(face[...,::-1].copy()).permute(2,0,1)[None].float()/127.5-1
                masked.append(vae.encode(rgb*mask).latent_dist.sample(generator=generator)*.18215)
                refs.append(vae.encode(rgb).latent_dist.sample(generator=generator)*.18215)
                if i%4==0:print(f'Encoded {i+1}/{len(faces)}',flush=True)
        payload={'requestSha256':digest,'reference':torch.cat(refs),'masked':torch.cat(masked),
                 'mask':torch.nn.functional.interpolate(mask[:,:1],size=(64,64),mode='nearest'),
                 'audio':torch.from_numpy(audio),'frames':len(faces)}
    elif a.stage=='sample':
        import gc,yaml
        from contextlib import nullcontext
        from spatial_attention_batching import spatial_attention_batches
        from diffusers import DDIMScheduler
        from latentsync_model_api import load_model_class
        data=torch.load(a.input,map_location='cpu',weights_only=True)
        if data['requestSha256']!=digest:raise ValueError('Request provenance mismatch')
        start=a.chunk_index*16;end=min(start+16,data['frames'])
        if not 0<=start<end:raise ValueError('Invalid chunk')
        receipt=json.loads(Path(d['checkpointReceipt']).read_text())
        ckpt=Path(d['checkpoint'])
        if receipt['status']!='SHA256_VERIFIED' or ckpt.resolve()!=Path(receipt['path']).resolve() or ckpt.stat().st_size!=receipt['bytes']:
            raise ValueError('Verified checkpoint required')
        cfg=yaml.safe_load((Path(d['upstream'])/'configs/unet/stage2_512.yaml').read_text())['model'];cfg['norm_eps']=float(cfg['norm_eps'])
        cls=load_model_class(d['upstream'])
        with torch.device('meta'):model=cls(**cfg)
        checkpoint=torch.load(ckpt,map_location='cpu',weights_only=True,mmap=True)
        torch.nn.Module.load_state_dict(model,checkpoint['state_dict'],strict=True,assign=True)
        model.eval().to(device='mps',dtype=torch.float16);del checkpoint;gc.collect()
        scheduler=DDIMScheduler.from_config(json.loads((Path(d['upstream'])/'configs/scheduler_config.json').read_text()))
        scheduler.set_timesteps(d['steps'],device='mps')
        n=end-start
        def video(t):return t[start:end].permute(1,0,2,3)[None].to(device='mps',dtype=torch.float16)
        ref=video(data['reference']);masked=video(data['masked'])
        mask=data['mask'][:,:,None].repeat(1,1,n,1,1).to(device='mps',dtype=torch.float16)
        audio=data['audio'][start:end].to(device='mps',dtype=torch.float16)
        # Upstream uses one spatial noise sample repeated across video frames.
        noise=torch.randn((1,4,1,64,64),generator=torch.Generator().manual_seed(d['seed']))
        latent=noise.repeat(1,1,n,1,1).to(device='mps',dtype=torch.float16)*scheduler.init_noise_sigma
        attention_scope=spatial_attention_batches(a.spatial_batch_size) if a.spatial_batch_size else nullcontext({})
        print(json.dumps({'stage':'sample','frames':n,'spatialBatchSize':a.spatial_batch_size,'mpsDriverBeforeBytes':torch.mps.driver_allocated_memory()}),flush=True)
        with torch.inference_mode(),attention_scope as attention_stats:
            for i,t in enumerate(scheduler.timesteps):
                inputs=torch.cat([scheduler.scale_model_input(latent,t),mask,masked,ref],dim=1)
                # Serial CFG keeps the temporal window intact without doubling batch memory.
                unconditional=model(inputs,t,encoder_hidden_states=torch.zeros_like(audio)).sample
                conditional=model(inputs,t,encoder_hidden_states=audio).sample
                prediction=unconditional+d['guidance']*(conditional-unconditional)
                latent=scheduler.step(prediction,t,latent,eta=0).prev_sample
                if not torch.isfinite(latent).all():raise ValueError('Nonfinite denoising state')
                del inputs,unconditional,conditional,prediction
                torch.mps.empty_cache()
                print(json.dumps({'chunk':a.chunk_index,'step':i+1,'steps':d['steps'],'mpsDriverBytes':torch.mps.driver_allocated_memory(),'attention':attention_stats}),flush=True)
        payload={'requestSha256':digest,'start':start,'end':end,'latents':latent.cpu(),'spatialBatchSize':a.spatial_batch_size,'attention':attention_stats}
    else:
        data=torch.load(a.input,map_location='cpu',weights_only=True)
        if data['requestSha256']!=digest:raise ValueError('Request provenance mismatch')
        vae=load_vae(d);images=[]
        with torch.inference_mode():
            for i in range(data['latents'].shape[2]):
                rgb=vae.decode(data['latents'][:,:,i].float()/.18215).sample
                images.append((rgb/2+.5).clamp(0,1).mul(255).round().byte().permute(0,2,3,1).cpu())
        payload={'requestSha256':digest,'start':data['start'],'end':data['end'],'rgb':torch.cat(images)}
    for value in payload.values():
        if isinstance(value,torch.Tensor) and not torch.isfinite(value).all():raise ValueError('Nonfinite stage artifact')
    partial=out.with_suffix('.partial.pt');torch.save(payload,partial);partial.replace(out)
    if a.stage=='decode':
        np.savez(out.with_suffix('.npz'),rgb=payload['rgb'].numpy(),start=payload['start'],end=payload['end'],requestSha256=payload['requestSha256'])
    print(json.dumps({'stage':a.stage,'output':str(out),'status':'COMPLETE_NOT_QUALITY_APPROVAL'}),flush=True)


def main():
    p=argparse.ArgumentParser();p.add_argument('request');p.add_argument('--stage',choices=['encode','sample','decode'],required=True)
    p.add_argument('--output',required=True);p.add_argument('--input');p.add_argument('--chunk-index',type=int,default=0);p.add_argument('--execute',action='store_true')
    p.add_argument('--spatial-batch-size',type=int,choices=[0,1,2],default=0)
    a=p.parse_args();request=Path(a.request);raw=request.read_bytes();d=json.loads(raw);digest=hashlib.sha256(raw).hexdigest();out=Path(a.output)
    if out.exists() or out.with_suffix('.partial.pt').exists():raise ValueError('Stage output exists')
    if d['steps']!=20 or not 1<=d['guidance']<=3:raise ValueError('Unsupported evaluation settings')
    if a.execute:return execute(a,d,digest)
    from media_resource_guard import bounded_media
    os.environ.update(OMP_NUM_THREADS='2',HF_HUB_OFFLINE='1',PYTORCH_ENABLE_MPS_FALLBACK='0',PYTORCH_MPS_HIGH_WATERMARK_RATIO='0.4',PYTORCH_MPS_LOW_WATERMARK_RATIO='0.3')
    out.parent.mkdir(parents=True,exist_ok=True);stats=None
    try:
        with bounded_media([sys.executable,__file__,*sys.argv[1:],'--execute'],out.parent,max_rss_mb=24576,min_free_gb=20,minimum_available_gb=8,max_swap_growth_gb=1,timeout=1800) as(proc,stats):proc.wait()
    finally:
        if stats is not None:out.with_suffix('.resources.json').write_text(json.dumps(stats,indent=2)+'\n')


if __name__=='__main__':main()
