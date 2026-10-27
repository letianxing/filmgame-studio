"""Bounded VAE round-trip regression; no diffusion, no film footage approval."""
import argparse,json,sys,gc
from pathlib import Path

p=argparse.ArgumentParser();p.add_argument('--model-dir',required=True);p.add_argument('--image',required=True);p.add_argument('--output',required=True);p.add_argument('--execute',action='store_true');a=p.parse_args();out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
if not a.execute:
 from media_resource_guard import bounded_media
 with bounded_media([sys.executable,__file__,'--model-dir',a.model_dir,'--image',a.image,'--output',a.output,'--execute'],out,max_rss_mb=8192,minimum_available_gb=8,max_swap_growth_gb=1,min_free_gb=2,timeout=600) as(proc,stats):proc.wait()
 (out/'resources.json').write_text(json.dumps(stats,indent=2));raise SystemExit
import mlx.core as mx
import numpy as np
from PIL import Image
from types import SimpleNamespace
from mlx_video.models.wan_2.utils import load_vae_encoder,load_vae_decoder
from wan_causal_decode import decode_causal
mx.set_memory_limit(6*1024**3);mx.set_cache_limit(256*1024**2)
config=SimpleNamespace(vae_z_dim=16);weights=Path(a.model_dir)/'vae.safetensors'
img=np.asarray(Image.open(a.image).convert('RGB').resize((512,288)),dtype=np.float32)/127.5-1
reference=mx.array(img).transpose(2,0,1)[None,:,None]
encoder=load_vae_encoder(weights,config);latent=encoder.encode(mx.repeat(reference,5,axis=2));mx.eval(latent)
del encoder;gc.collect();mx.clear_cache()
decoder=load_vae_decoder(weights,config);rows=[]
for name,fn in [('installed_full_decode',decoder.decode),('causal_adapter',lambda z:decode_causal(decoder,z))]:
 result=fn(latent);mx.eval(result);data=np.asarray(result[0]).transpose(1,2,3,0);errors=np.mean((data-img[None])**2,axis=(1,2,3));psnr=10*np.log10(4/np.maximum(errors,1e-12))
 rows.append({'mode':name,'inputFrames':5,'latentFrames':int(latent.shape[2]),'outputFrames':len(data),'psnrPerFrame':psnr.tolist()})
 Image.fromarray(np.clip((data[0]+1)*127.5,0,255).astype('uint8')).save(out/(name+'-first.png'))
 del result,data;gc.collect();mx.clear_cache()
(out/'comparison.json').write_text(json.dumps({'diagnostic':'VAE reconstruction of a repeated still for regression only, not generated film footage','results':rows},indent=2));print(json.dumps(rows),flush=True)
