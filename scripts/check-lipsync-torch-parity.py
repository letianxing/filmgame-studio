"""Independent diffusers CPU reference using existing converted fp16 weights.

Tests backend math, not whether conversion preserved original upstream weights.
No upstream files are modified; UNet and VAE execute serially on CPU.
"""
import argparse,json,os,sys
from pathlib import Path


def main():
    p=argparse.ArgumentParser()
    for name in ['fixture','models','dependencies','output-dir']:p.add_argument('--'+name,required=True)
    p.add_argument('--execute',action='store_true');a=p.parse_args()
    out=Path(a.output_dir)
    if out.exists():raise ValueError('Output exists')
    if not a.execute:
        from media_resource_guard import bounded_media
        os.environ.update(HF_HUB_OFFLINE='1',OMP_NUM_THREADS='2',TOKENIZERS_PARALLELISM='false')
        with bounded_media([sys.executable,__file__,*sys.argv[1:],'--execute'],out.parent,max_rss_mb=16384,min_free_gb=20,minimum_available_gb=8,max_swap_growth_gb=1,timeout=900) as(proc,stats):proc.wait()
        out.with_suffix('.resources.json').write_text(json.dumps(stats,indent=2)+'\n');return
    sys.path.insert(0,str(Path(a.dependencies).resolve()))
    import gc,numpy as np,torch
    from PIL import Image
    from safetensors import safe_open
    from diffusers import UNet2DConditionModel,AutoencoderKL
    torch.set_num_threads(2);torch.set_num_interop_threads(1)
    meta=json.loads(Path(a.fixture).with_suffix('.json').read_text())
    data=np.load(a.fixture);models=Path(a.models)
    if json.loads((models/'config.json').read_text()).get('quantization'):
        raise ValueError('Only unquantized native weights supported')
    out.mkdir()
    def load(cls,config,path):
        with torch.device('meta'):model=cls(**{k:v for k,v in config.items() if not k.startswith('_')})
        weights={}
        with safe_open(str(path),framework='pt',device='cpu') as f:
            for key in f.keys():
                v=f.get_tensor(key)
                if key.endswith('.weight') and v.ndim==4:v=v.permute(0,3,1,2)
                elif key.endswith('.weight') and v.ndim==3:v=v.permute(0,2,1)
                weights[key]=v.contiguous().float()
        model.load_state_dict(weights,strict=True,assign=True);model.eval();return model
    unet=load(UNet2DConditionModel,meta['unetConfig'],models/'unet.safetensors')
    with torch.inference_mode():
        pred=unet(torch.from_numpy(data['latents']),torch.tensor([0]),encoder_hidden_states=torch.from_numpy(data['audio_with_pe'])).sample
    np.save(out/'prediction.npy',pred.numpy());del unet;gc.collect()
    vae=load(AutoencoderKL,meta['vaeConfig'],models/'vae.safetensors')
    with torch.inference_mode():
        image=vae.decode(pred/meta['scalingFactor']).sample
        recon=(image/2+.5).clamp(0,1).permute(0,2,3,1).numpy()
        recon=(recon*255).round().astype(np.uint8)[...,::-1].copy()
    Image.fromarray(recon[0,...,::-1]).save(out/'torch-reconstruction.png')
    Image.fromarray(np.concatenate([data['crop'],data['reconstruction'][0],recon[0]],axis=1)[...,::-1]).save(out/'comparison.png')
    delta=np.abs(pred.numpy()-data['prediction']);pixels=np.abs(recon.astype(np.int16)-data['reconstruction'].astype(np.int16))
    report={'status':'COMPARISON_COMPLETE_REVIEW_REQUIRED','torchVersion':torch.__version__,'referencePrecision':'CPU float32 on stored fp16 weights','candidatePrecision':meta['precision'],'latentMeanAbsoluteError':float(delta.mean()),'latentMaxAbsoluteError':float(delta.max()),'latentRelativeMaxError':float(delta.max()/(np.abs(data['prediction']).max()+1e-8)),'pixelMeanAbsoluteError':float(pixels.mean()),'pixelMaxAbsoluteError':int(pixels.max()),'columns':['source','MLX','PyTorch'],'limitations':['Shared converted weights do not verify original weight conversion.','Single face and audio timestamp; not lip-sync or temporal acceptance.','Comparison includes float16 versus float32 arithmetic.']}
    (out/'result.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)


if __name__=='__main__':main()
