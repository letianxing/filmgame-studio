"""Decode only a completed MultiAnimate schedule, preserving every real frame."""
import argparse,hashlib,json,os,sys
from pathlib import Path


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('request',type=Path);p.add_argument('--execute',action='store_true');a=p.parse_args()
    raw=a.request.read_bytes();d=json.loads(raw);root=a.request.parent;out=root/'decode-complete.json'
    if out.exists() or (root/'decoded-frames').exists():raise ValueError('Decode output exists; preserve it')
    if not a.execute:
        from media_resource_guard import bounded_media
        os.environ.update(HF_HUB_OFFLINE='1',OMP_NUM_THREADS='2',PYTORCH_ENABLE_MPS_FALLBACK='0');stats=None
        try:
            with bounded_media([sys.executable,__file__,str(a.request),'--execute'],root,max_rss_mb=8192,min_free_gb=20,minimum_available_gb=8,max_swap_growth_gb=1,timeout=1800) as(proc,stats):proc.wait()
        finally:
            if stats is not None:(root/'decode.resources.json').write_text(json.dumps(stats,indent=2)+'\n')
        return
    sys.path.insert(0,d['comfyHome']);sys.argv=['decode','--cpu','--cpu-vae','--fp32-vae']
    import comfy.options
    comfy.options.enable_args_parsing()
    import torch,nodes,folder_paths
    from PIL import Image
    torch.set_num_threads(2)
    checkpoint=torch.load(root/f'sample-{d["steps"]:03d}.pt',map_location='cpu',weights_only=True)
    assert checkpoint['requestSha256']==hashlib.sha256(raw).hexdigest() and checkpoint['nextStep']==checkpoint['totalSteps']==d['steps']
    pack_raw=Path(d['inputPack']).read_bytes();assert hashlib.sha256(pack_raw).hexdigest()==checkpoint['inputPackSha256']==d['inputPackSha256'];pack=json.loads(pack_raw)
    folder_paths.add_model_folder_path('vae',str(Path(d['modelRoot'])/'vae'),is_default=True)
    with torch.inference_mode():
        vae=nodes.VAELoader().load_vae(d['vae'])[0];assert vae.latent_channels==16
        frames=nodes.VAEDecode().decode(vae,checkpoint['latent'])[0]
        w,h=pack['size'];assert list(frames.shape)==[pack['frames'],h,w,3] and torch.isfinite(frames).all()
        folder=root/'decoded-frames';folder.mkdir(exist_ok=False);hashes=[]
        for i,frame in enumerate(frames):
            target=folder/f'frame-{i:03d}.png';Image.fromarray((frame.cpu().clamp(0,1).numpy()*255).round().astype('uint8')).save(target);hashes.append(hashlib.sha256(target.read_bytes()).hexdigest())
    report={'status':'DECODE_COMPLETE_VISUAL_REVIEW_REQUIRED','requestSha256':checkpoint['requestSha256'],'frames':len(hashes),'size':pack['size'],'fps':pack['fps'],'frameSha256':hashes,'productionApproved':False}
    out.write_text(json.dumps(report,indent=2)+'\n');print('Decoded',len(hashes),'frames; visual review required',flush=True)


if __name__=='__main__':main()
