"""One full-width, two-frame 512px-equivalent UNet call under Mac guard.

Random conditions test loading/runtime only; this cannot establish media quality.
"""
import argparse,json,os,sys,time
from pathlib import Path


def main():
    p=argparse.ArgumentParser()
    for name in ['upstream','dependencies','checkpoint','receipt','output']:p.add_argument('--'+name,required=True)
    p.add_argument('--execute',action='store_true');a=p.parse_args();out=Path(a.output)
    if out.exists():raise ValueError('Output exists')
    receipt=json.loads(Path(a.receipt).read_text());checkpoint=Path(a.checkpoint)
    if receipt['status']!='SHA256_VERIFIED' or Path(receipt['path']).resolve()!=checkpoint.resolve() or checkpoint.stat().st_size!=receipt['bytes']:
        raise ValueError('Verified download receipt required')
    if not a.execute:
        from media_resource_guard import bounded_media
        os.environ.update(OMP_NUM_THREADS='2',PYTORCH_ENABLE_MPS_FALLBACK='0',PYTORCH_MPS_HIGH_WATERMARK_RATIO='0.4',PYTORCH_MPS_LOW_WATERMARK_RATIO='0.3')
        out.parent.mkdir(parents=True,exist_ok=True);stats=None
        try:
            with bounded_media([sys.executable,__file__,*sys.argv[1:],'--execute'],out.parent,max_rss_mb=24576,min_free_gb=20,minimum_available_gb=8,max_swap_growth_gb=1,timeout=900) as(proc,stats):proc.wait()
        finally:
            if stats is not None:out.with_suffix('.resources.json').write_text(json.dumps(stats,indent=2)+'\n')
        return
    sys.path.insert(0,str(Path(a.dependencies).resolve()))
    import gc,torch,yaml
    from latentsync_model_api import load_model_class
    torch.set_num_threads(2);torch.set_num_interop_threads(1);torch.manual_seed(7)
    cfg=yaml.safe_load((Path(a.upstream)/'configs/unet/stage2_512.yaml').read_text())['model'];cfg['norm_eps']=float(cfg['norm_eps'])
    cls=load_model_class(a.upstream)
    with torch.device('meta'):model=cls(**cfg)
    raw=torch.load(checkpoint,map_location='cpu',weights_only=True,mmap=True)
    state=raw['state_dict']
    # Bypass upstream's permissive override: exact keys/shapes, no dropped layers.
    torch.nn.Module.load_state_dict(model,state,strict=True,assign=True)
    model.eval().to(device='mps',dtype=torch.float16)
    del raw,state;gc.collect()
    print('Full checkpoint loaded strictly; starting one 2-frame UNet call',flush=True)
    x=torch.randn(1,13,2,64,64,device='mps',dtype=torch.float16)
    audio=torch.randn(2,50,384,device='mps',dtype=torch.float16)
    started=time.monotonic()
    with torch.inference_mode():result=model(x,torch.tensor([500],device='mps'),encoder_hidden_states=audio).sample
    torch.mps.synchronize()
    if not torch.isfinite(result).all():raise ValueError('Nonfinite full-model output')
    report={'status':'FULL_WEIGHTS_SINGLE_STEP_COMPLETE_NOT_QUALITY_APPROVAL','shape':list(result.shape),'seconds':time.monotonic()-started,'outputStd':result.float().std().item(),'checkpointSha256':receipt['sha256'],'cpuFallback':False,'mpsAllocatedBytes':torch.mps.current_allocated_memory(),'mpsDriverBytes':torch.mps.driver_allocated_memory(),'limitations':['Two frames and one denoising step only.','Random conditions, not a generated lip-sync sample.','16-frame temporal windows and full denoising memory/time remain untested.']}
    out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)


if __name__=='__main__':main()
