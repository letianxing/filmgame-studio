"""Paired static reconstruction diagnostic, not animation or production media.

Compare one native reference crop with the SAME crop downsampled to a small
video-face width. Geometry, model and audio features are held fixed.
"""
import argparse,json,os,sys
from pathlib import Path


def execute(a):
    import cv2
    import numpy as np
    import mediapipe as mp
    import mlx.core as mx
    import musetalk_mlx.pipeline_mlx as module
    from lipsync_audio_timing import audio_timing_adapter
    cv2.setNumThreads(2);mx.set_memory_limit(12*1024**3);mx.set_cache_limit(256*1024**2)
    out=Path(a.output_dir);out.mkdir(exist_ok=False)
    im=cv2.imread(a.image)
    if im is None or im.shape[0]*im.shape[1]>4096*4096:raise ValueError('Invalid bounded image')
    h,w=im.shape[:2]
    with mp.solutions.face_mesh.FaceMesh(static_image_mode=True,max_num_faces=2) as detector:
        faces=detector.process(cv2.cvtColor(im,cv2.COLOR_BGR2RGB)).multi_face_landmarks
        if not faces or len(faces)!=1:raise ValueError('Exactly one reference face required')
        pts=np.array([(v.x*w,v.y*h) for v in faces[0].landmark])
    bottom=float(pts[:,1].max());mid=float(pts[195,1])
    box=[max(0,int(pts[:,0].min())),max(0,int(2*mid-bottom)),min(w,int(pts[:,0].max())),min(h,int(bottom)+round(10*w/512))]
    x1,y1,x2,y2=box;native=im[y1:y2,x1:x2]
    if native.shape[1]<200:raise ValueError('Reference has insufficient native face detail')
    low=cv2.resize(native,(74,round(native.shape[0]*74/native.shape[1])),interpolation=cv2.INTER_AREA)
    crops=[cv2.resize(v,(256,256),interpolation=cv2.INTER_AREA if v.shape[1]>256 else cv2.INTER_LINEAR) for v in [native,low]]
    pipe=module.MuseTalkPipeline.from_pretrained_mlx(a.model_dir)
    if not a.vae_only:
        with audio_timing_adapter(module):chunks=pipe.encode_audio_from_wav(a.audio,fps=25)
        mx.eval(chunks)
    indexes=[5,15,25]
    if not a.vae_only and len(chunks)<=max(indexes):raise ValueError('Audio too short')
    panels=[]
    for name,crop in zip(['native','downsampled-74px'],crops):
        cv2.imwrite(str(out/(name+'-input.png')),crop)
        latent=pipe.get_latents_for_unet(crop);mx.eval(latent)
        row=[crop]
        for i in (['vae'] if a.vae_only else indexes):
            # The second four channels are the unmasked reference posterior
            # mean, already multiplied by the model scaling factor.
            result=pipe.decode_latents(latent[:,4:])[0] if a.vae_only else pipe.run_batched(latent,chunks[i:i+1],batch_size=1)[0]
            suffix=i if isinstance(i,str) else f'{i:03d}'
            cv2.imwrite(str(out/f'{name}-{suffix}.png'),result);row.append(result)
        panels.append(np.hstack(row));del latent;mx.clear_cache()
    cv2.imwrite(str(out/'comparison.png'),np.vstack(panels))
    (out/'receipt.json').write_text(json.dumps({'status':'STATIC_RECONSTRUCTION_DIAGNOSTIC_NOT_PRODUCTION','source':a.image,'audio':None if a.vae_only else a.audio,'nativeBox':box,'nativeFaceSize':[native.shape[1],native.shape[0]],'modelSize':[256,256],'rows':['native','downsampled-74px'],'columns':['input',*(['VAE roundtrip'] if a.vae_only else [f'audio at {i/25}s' for i in indexes])],'limitations':['Static reference only, not a temporal or lip-sync acceptance test.','Crop uses experimental MediaPipe anchor 195.']},indent=2)+'\n')


def main():
    p=argparse.ArgumentParser()
    for name in ['image','audio','model-dir','output-dir']:p.add_argument('--'+name,required=True)
    p.add_argument('--vae-only',action='store_true')
    p.add_argument('--execute',action='store_true');a=p.parse_args()
    if a.execute:return execute(a)
    from media_resource_guard import bounded_media
    os.environ.update(HF_HUB_OFFLINE='1',OMP_NUM_THREADS='2')
    output=Path(a.output_dir);output.parent.mkdir(parents=True,exist_ok=True)
    if output.exists():raise ValueError('Output exists')
    with bounded_media([sys.executable,__file__,*sys.argv[1:],'--execute'],output.parent,max_rss_mb=16384,min_free_gb=20,minimum_available_gb=8,max_swap_growth_gb=1,timeout=900) as(proc,stats):proc.wait()
    output.with_suffix('.resources.json').write_text(json.dumps(stats,indent=2)+'\n')


if __name__=='__main__':main()
