"""Capture actual face/audio tensors for a separate reference-backend check."""
import argparse,json,os,sys
from pathlib import Path


def main():
    p=argparse.ArgumentParser()
    for name in ['crop','audio','models','output']:p.add_argument('--'+name,required=True)
    p.add_argument('--execute',action='store_true');a=p.parse_args()
    out=Path(a.output)
    if out.exists():raise ValueError('Output already exists')
    if not a.execute:
        from media_resource_guard import bounded_media
        os.environ.update(HF_HUB_OFFLINE='1',OMP_NUM_THREADS='2')
        out.parent.mkdir(parents=True,exist_ok=True)
        with bounded_media([sys.executable,__file__,*sys.argv[1:],'--execute'],out.parent,max_rss_mb=16384,min_free_gb=20,minimum_available_gb=8,max_swap_growth_gb=1,timeout=900) as(proc,stats):proc.wait()
        out.with_suffix('.resources.json').write_text(json.dumps(stats,indent=2)+'\n')
        return
    import cv2,numpy as np,mlx.core as mx
    import musetalk_mlx.pipeline_mlx as module
    from musetalk_mlx.whisper.audio2feature import apply_pe
    from musetalk_mlx.config import UNET_CONFIG,VAE_CONFIG
    from lipsync_audio_timing import audio_timing_adapter
    cv2.setNumThreads(2);mx.set_memory_limit(12*1024**3);mx.set_cache_limit(256*1024**2)
    crop=cv2.imread(a.crop)
    if crop is None or crop.shape!=(256,256,3):raise ValueError('Exact diagnostic crop required')
    pipe=module.MuseTalkPipeline.from_pretrained_mlx(a.models)
    with audio_timing_adapter(module):chunks=pipe.encode_audio_from_wav(a.audio,fps=25)
    latent=pipe.get_latents_for_unet(crop);mx.eval(latent,chunks)
    dtype=pipe._dtype
    lb=latent.astype(dtype);cb=chunks[15:16].astype(dtype)
    if cb.shape[0]!=1:raise ValueError('Audio too short')
    audio=apply_pe(cb);pred=pipe.unet(lb,mx.array([0]),audio);mx.eval(pred)
    recon=pipe.decode_latents(pred)
    np.savez(out,crop=crop,latents=np.array(lb.astype(mx.float32)),audio_with_pe=np.array(audio.astype(mx.float32)),prediction=np.array(pred.astype(mx.float32)),reconstruction=recon)
    out.with_suffix('.json').write_text(json.dumps({'status':'REFERENCE_COMPARISON_PENDING','unetConfig':UNET_CONFIG,'vaeConfig':VAE_CONFIG,'scalingFactor':pipe.scaling_factor,'sourceCrop':a.crop,'audio':a.audio,'audioFrame':15,'fps':25,'precision':'float16 inference; tensors exported as float32','scope':'Isolates UNet and decoder backend parity; shared input tensors do not establish audio frontend parity.'},indent=2)+'\n')


if __name__=='__main__':main()
