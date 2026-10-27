"""Guarded small random-network CPU/MPS smoke; not a model quality test."""
import argparse,json,os,sys
from pathlib import Path


def main():
    p=argparse.ArgumentParser()
    for name in ['upstream','dependencies','output']:p.add_argument('--'+name,required=True)
    p.add_argument('--execute',action='store_true');a=p.parse_args();out=Path(a.output)
    if out.exists():raise ValueError('Output exists')
    if not a.execute:
        from media_resource_guard import bounded_media
        os.environ.update(OMP_NUM_THREADS='2',PYTORCH_ENABLE_MPS_FALLBACK='0',PYTORCH_MPS_HIGH_WATERMARK_RATIO='0.4',PYTORCH_MPS_LOW_WATERMARK_RATIO='0.3')
        out.parent.mkdir(parents=True,exist_ok=True)
        with bounded_media([sys.executable,__file__,*sys.argv[1:],'--execute'],out.parent,max_rss_mb=12288,min_free_gb=20,minimum_available_gb=8,max_swap_growth_gb=1,timeout=300) as(proc,stats):proc.wait()
        out.with_suffix('.resources.json').write_text(json.dumps(stats,indent=2)+'\n');return
    sys.path.insert(0,str(Path(a.dependencies).resolve()))
    import torch,yaml
    from latentsync_model_api import load_model_class
    torch.set_num_threads(2);torch.set_num_interop_threads(1);torch.manual_seed(7)
    cls=load_model_class(a.upstream)
    cfg=yaml.safe_load((Path(a.upstream)/'configs/unet/stage2_512.yaml').read_text())['model']
    # PyYAML treats the upstream spelling 1e-5 as text; OmegaConf does not.
    cfg['norm_eps']=float(cfg['norm_eps'])
    cfg.update(block_out_channels=[32,64,64,64],layers_per_block=1)
    model=cls(**cfg).eval()
    # Upstream zero-initializes input/output and temporal projections. A zero
    # output would make backend comparison vacuous; activate these test weights.
    with torch.no_grad():
        for parameter in model.parameters():
            if parameter.ndim>=2 and torch.count_nonzero(parameter)==0:
                torch.nn.init.normal_(parameter,mean=0,std=.01)
    x=torch.randn(1,13,2,8,8);audio=torch.randn(2,50,384);t=torch.tensor([10])
    with torch.inference_mode():
        cpu=model(x,t,encoder_hidden_states=audio).sample
        model.to('mps')
        mps=model(x.to('mps'),t.to('mps'),encoder_hidden_states=audio.to('mps')).sample.cpu()
    if not torch.isfinite(mps).all():raise ValueError('Nonfinite MPS output')
    if cpu.std()<1e-5:raise ValueError('Degenerate constant smoke output')
    delta=(cpu-mps).abs()
    report={'status':'SMALL_KERNEL_SMOKE_COMPLETE','shape':list(mps.shape),'maxAbsoluteError':delta.max().item(),'meanAbsoluteError':delta.mean().item(),'cpuFallback':False,'limitations':['Random small network only; full model memory/performance and quality remain untested.','No face detection, audio encoding or video restoration tested.']}
    out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)


if __name__=='__main__':main()
