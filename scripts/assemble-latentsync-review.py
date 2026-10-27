"""Restore complete decoded chunks to the original shot and untouched speech.

Experiment only. Requires exact ordered frame coverage; never loops or pads.
"""
import argparse,hashlib,json,math,subprocess
from pathlib import Path


def main():
    p=argparse.ArgumentParser();p.add_argument('request');p.add_argument('--chunks',nargs='+',required=True)
    p.add_argument('--audio',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    import cv2,numpy as np,soundfile as sf
    from media_resource_guard import bounded_media
    cv2.setNumThreads(2)
    request=Path(a.request).read_bytes();d=json.loads(request);digest=hashlib.sha256(request).hexdigest()
    out=Path(a.output);partial=out.with_suffix('.partial.mp4')
    if out.exists() or partial.exists():raise ValueError('Output exists')
    source=np.load(d['faces']);originals=source['originals'];matrices=source['matrices']
    samples,sr=sf.read(a.audio);duration=len(samples)/sr;count=len(originals)
    audio_meta=json.loads(Path(d['audioFeatures']).with_suffix('.json').read_text())
    if Path(audio_meta['sourceAudio']).resolve()!=Path(a.audio).resolve() or count!=math.ceil(duration*25):
        raise ValueError('Original speech or frame budget mismatch')
    chunks=[];expected=0
    for name in a.chunks:
        chunk=np.load(name)
        if str(chunk['requestSha256'])!=digest or int(chunk['start'])!=expected:raise ValueError('Chunk provenance/order mismatch')
        rgb=chunk['rgb'];end=int(chunk['end'])
        if rgb.shape!=(end-expected,512,512,3) or rgb.dtype!=np.uint8:raise ValueError('Invalid decoded frames')
        chunks.append(rgb);expected=end
    if expected!=count:raise ValueError('Incomplete speech frame coverage')
    mask=np.load(d['preparedMask'])[:,:,0]
    alpha=cv2.GaussianBlur(1-mask,(7,7),1.2)
    alpha=cv2.resize(alpha,(420,560),interpolation=cv2.INTER_LINEAR)
    h,w=originals.shape[1:3]
    cmd=['ffmpeg','-v','error','-nostdin','-filter_threads','1','-f','rawvideo','-pix_fmt','bgr24','-s',f'{w}x{h}','-r','25','-i','pipe:0','-i',a.audio,'-map','0:v','-map','1:a','-c:v','libx264','-threads','2','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',str(partial)]
    log_path=out.with_suffix('.ffmpeg.log');i=0
    with log_path.open('w') as log:
        try:
            with bounded_media(cmd,out.parent,max_rss_mb=1024,min_free_gb=2,timeout=1800,stdin=subprocess.PIPE,stderr=log) as(proc,stats):
                for rgb_frames in chunks:
                    for rgb in rgb_frames:
                        face=cv2.resize(rgb[...,::-1],(420,560),interpolation=cv2.INTER_LINEAR).astype(np.float32)
                        inverse=cv2.invertAffineTransform(matrices[i])
                        premultiplied=cv2.warpAffine(face*alpha[:,:,None],inverse,(w,h),flags=cv2.INTER_LINEAR)
                        support=cv2.warpAffine(alpha,inverse,(w,h),flags=cv2.INTER_LINEAR).clip(0,1)
                        frame=(premultiplied+originals[i]*(1-support[:,:,None])).clip(0,255).round().astype(np.uint8)
                        proc.stdin.write(frame.tobytes());i+=1
                proc.stdin.close();proc.wait()
        except (BrokenPipeError,subprocess.CalledProcessError) as error:
            log.flush()
            raise RuntimeError(f'Encoder failed; preserved partial and diagnostics at {log_path}') from error
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(partial)],text=True))
    video=next(s for s in probe['streams'] if s['codec_type']=='video');audio=next(s for s in probe['streams'] if s['codec_type']=='audio')
    if int(video['nb_frames'])!=count or float(audio['duration'])<duration-.005:raise ValueError('Mux lost frames or speech')
    partial.replace(out)
    out.with_suffix('.review.json').write_text(json.dumps({'status':'EXPERIMENT_REQUIRES_VISUAL_AND_SYNC_REVIEW','output':str(out),'frames':count,'fps':25,'audioSeconds':duration,'sourceAudio':a.audio,'requestSha256':digest,'chunks':a.chunks,'productionApproved':False,'limitations':['Original source acting and head direction remain unchanged.','Restoration uses a first-party feathered model mask; semantic identity and temporal quality require review.'],'encoderResources':stats},indent=2)+'\n')


if __name__=='__main__':main()
