"""CPU VAE isolation on repeated stills; no diffusion or production animation."""
import argparse,json,os,sys
from pathlib import Path


def main():
    p=argparse.ArgumentParser()
    for name in ['comfy-home','model-root','image','output-dir']:p.add_argument('--'+name,required=True)
    p.add_argument('--frame-count',type=int,choices=[1,5,49])
    p.add_argument('--execute',action='store_true');a=p.parse_args();out=Path(a.output_dir)
    if out.exists():raise ValueError('Output exists')
    if not a.execute:
        from media_resource_guard import bounded_media
        os.environ.update(OMP_NUM_THREADS='2',HF_HUB_OFFLINE='1');stats=None
        try:
            with bounded_media([sys.executable,__file__,*sys.argv[1:],'--execute'],out.parent,max_rss_mb=16384,min_free_gb=20,minimum_available_gb=8,max_swap_growth_gb=1,timeout=600) as(proc,stats):proc.wait()
        finally:
            if stats is not None:out.with_suffix('.resources.json').write_text(json.dumps(stats,indent=2)+'\n')
        return
    sys.path.insert(0,str(Path(a.comfy_home).resolve()));sys.argv=['vae-roundtrip','--cpu','--cpu-vae','--fp32-vae']
    import comfy.options
    comfy.options.enable_args_parsing()
    import torch,numpy as np,nodes,folder_paths,comfy.utils
    from PIL import Image
    torch.set_num_threads(2);out.mkdir()
    folder_paths.add_model_folder_path('vae',str(Path(a.model_root).resolve()/'vae'),is_default=True)
    source=torch.from_numpy(np.array(Image.open(a.image).convert('RGB')).astype(np.float32)/255)[None]
    source=comfy.utils.common_upscale(source.movedim(-1,1),512,288,'bilinear','center').movedim(1,-1)
    vae=nodes.VAELoader().load_vae('wan2.2_vae.safetensors')[0]
    results=[]
    with torch.inference_mode():
        for count in ([a.frame_count] if a.frame_count else [1,5]):
            images=source.repeat(count,1,1,1);latent=vae.encode(images)
            decoded=nodes.VAEDecode().decode(vae,{'samples':latent})[0]
            if len(decoded)!=count or not torch.isfinite(decoded).all():raise ValueError('Invalid roundtrip')
            errors=((decoded.cpu()-images)**2).mean((1,2,3));psnr=-10*torch.log10(errors.clamp_min(1e-12))
            for index in sorted(set([0,count//2,count-1])):
                Image.fromarray((decoded[index].cpu().clamp(0,1).numpy()*255).round().astype('uint8')).save(out/f'roundtrip-{count}-{index}.png')
            results.append({'inputFrames':count,'latentShape':list(latent.shape),'decodedFrames':len(decoded),'psnrPerFrame':psnr.tolist()})
    Image.fromarray((source[0].numpy()*255).round().astype('uint8')).save(out/'source.png')
    report={'status':'VAE_ROUNDTRIP_COMPLETE_REVIEW_REQUIRED','source':a.image,'results':results,'limitations':['Repeated still is an isolation diagnostic, not film motion.','No diffusion, control conditioning or quantized DiT evaluated.']}
    (out/'result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)


if __name__=='__main__':main()
