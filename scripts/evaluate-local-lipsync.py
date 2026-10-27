"""Short, guarded MuseTalk MLX experiment. Not a production quality approval.

Uses upstream neural API through a configured checkout. A first-party feathered
lower-face mask preserves upper-face pixels; it is not upstream BiSeNet blending.
No frame cycling: audio must fit the actual source video.
"""
import argparse
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys

def speech_frame_budget(duration, fps, available_frames):
    if not math.isfinite(duration) or duration <= 0 or not math.isfinite(fps) or not 1 <= fps <= 30:
        raise ValueError('Invalid speech timing')
    if abs(fps-round(fps)) > .001:
        raise ValueError('This frontend requires integer frame rates')
    required = math.ceil(duration*fps)
    if required > available_frames:
        raise ValueError('Source video does not cover complete speech')
    return required

def validate_request(data):
    if data.get('faceCropAnchor','bridge-6') not in ('bridge-6','midnose-195-experimental'):
        raise ValueError('Unsupported face crop anchor')
    if data.get('audioFeatureTiming','upstream') not in ('upstream','timestamp-v1'):
        raise ValueError('Unsupported audio feature timing')
    diagnostic_frames=data.get('diagnosticFrames',[])
    if not isinstance(diagnostic_frames,list) or len(diagnostic_frames)>8 or any(type(i) is not int or not 0<=i<125 for i in diagnostic_frames):
        raise ValueError('Diagnostic frame selection must contain at most 8 bounded indexes')
    if 'preserveUpperLip' in data and type(data['preserveUpperLip']) is not bool:
        raise ValueError('preserveUpperLip must be boolean')
    if 'faceDetectionRegion' in data:
        region=data['faceDetectionRegion']
        if not isinstance(region,list) or len(region)!=4 or not all(isinstance(v,(int,float)) and math.isfinite(v) for v in region):
            raise ValueError('Invalid face detection region')
        x1,y1,x2,y2=region
        if not 0<=x1<x2<=1 or not 0<=y1<y2<=1 or not data.get('singleSubjectVisualReview'):
            raise ValueError('A bounded region requires explicit single-subject review evidence')
        if not Path(data['singleSubjectVisualReview']).is_file():
            raise ValueError('Single-subject review evidence is missing')
    for key in ('video', 'audio', 'modelDir', 'output'):
        if not isinstance(data.get(key), str) or not data[key]:
            raise ValueError('Missing path: '+key)
    if Path(data['output']).exists():
        raise ValueError('Output already exists')
    if not 0 < data.get('maxSeconds', 0) <= 4:
        raise ValueError('Only <=4 second experiments are supported')

def execute(data):
    import cv2
    import mediapipe as mp
    import mlx.core as mx
    import numpy as np
    import soundfile as sf
    from musetalk_mlx.pipeline_mlx import MuseTalkPipeline
    mx.set_memory_limit(12*1024**3)
    mx.set_cache_limit(256*1024**2)
    cv2.setNumThreads(2)
    audio, sr = sf.read(data['audio'])
    duration = len(audio)/sr
    if duration > data['maxSeconds']:
        raise ValueError('Audio exceeds requested short-test limit')
    cap = cv2.VideoCapture(data['video'])
    fps = cap.get(cv2.CAP_PROP_FPS)
    count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if not 1 <= fps <= 30 or count/fps > 4.1 or duration > count/fps:
        raise ValueError('Video must be <=4 seconds and cover the complete audio')
    required_frames = speech_frame_budget(duration,fps,count)
    from lip_region_mask import lip_mask
    frames, boxes, masks = [], [], []
    # Detect separately in each real frame. Fail closed on missing or extra faces.
    with mp.solutions.face_mesh.FaceMesh(static_image_mode=True, max_num_faces=2,
            min_detection_confidence=.5) as detector:
        for i in range(count):
            ok, frame = cap.read()
            if not ok:raise ValueError('Could not decode every source frame')
            h,w = frame.shape[:2]
            if w*h > 1280*720:raise ValueError('Input resolution exceeds safe test profile')
            rx1,ry1,rx2,ry2=data.get('faceDetectionRegion',[0,0,1,1])
            x0,y0,xend,yend=round(rx1*w),round(ry1*h),round(rx2*w),round(ry2*h)
            detection_frame=frame[y0:yend,x0:xend]
            if detection_frame.size==0:raise ValueError('Empty detection region')
            found = detector.process(cv2.cvtColor(detection_frame,cv2.COLOR_BGR2RGB)).multi_face_landmarks
            if not found or len(found)!=1:raise ValueError(f'Expected exactly one face at frame {i}')
            pts=np.array([(p.x*(xend-x0)+x0,p.y*(yend-y0)+y0) for p in found[0].landmark])
            # Explicit calibration candidate, not an asserted equivalence to
            # the upstream 68-point landmark convention.
            anchor=195 if data.get('faceCropAnchor')=='midnose-195-experimental' else 6
            bottom=float(pts[:,1].max());mid=float(pts[anchor,1])
            box=(max(0,int(pts[:,0].min())),max(0,int(2*mid-bottom)),
                 min(w,int(pts[:,0].max())),min(h,int(bottom)+10))
            if box[2]-box[0]<32 or box[3]-box[1]<32:raise ValueError('Face too small')
            frames.append(frame);boxes.append(box);masks.append(lip_mask(pts,box,preserve_upper_lip=data.get('preserveUpperLip',False)))
    cap.release()
    print(json.dumps({'detectedFrames':len(frames),'fps':fps}),flush=True)
    pipe=MuseTalkPipeline.from_pretrained_mlx(data['modelDir'])
    # The installed frontend floors audio duration to frames. Pad its input only
    # so the final partial speech frame is inferred; mux the untouched original.
    padded_samples = math.ceil(required_frames*sr/fps)+1
    padding = [(0,max(0,padded_samples-len(audio)))]+[(0,0)]*(audio.ndim-1)
    feature_audio=Path(data['output']).with_suffix('.features.wav')
    sf.write(feature_audio,np.pad(audio,padding),sr)
    if data.get('audioFeatureTiming','upstream')=='timestamp-v1':
        import musetalk_mlx.pipeline_mlx as pipeline_module
        from lipsync_audio_timing import audio_timing_adapter
        with audio_timing_adapter(pipeline_module):
            chunks=pipe.encode_audio_from_wav(feature_audio,fps=int(round(fps)))
    else:
        chunks=pipe.encode_audio_from_wav(feature_audio,fps=int(round(fps)))
    mx.eval(chunks)
    if len(chunks)<required_frames or required_frames>len(frames):raise ValueError('Audio features do not cover complete speech')
    out=Path(data['output']);partial=out.with_suffix('.partial.mp4')
    diagnostic_rows=[]
    diagnostic_dir=out.with_suffix('.diagnostics')
    if data.get('diagnosticFrames'):
        if max(data['diagnosticFrames'])>=required_frames:raise ValueError('Diagnostic index beyond speech frame budget')
        diagnostic_dir.mkdir(exist_ok=False)
    h,w=frames[0].shape[:2]
    cmd=['ffmpeg','-v','error','-y','-filter_threads','1','-f','rawvideo','-pix_fmt','bgr24',
         '-s',f'{w}x{h}','-r',str(fps),'-i','pipe:0','-i',data['audio'],
         '-map','0:v','-map','1:a','-c:v','libx264','-threads','2','-crf','18',
         '-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',str(partial)]
    encoder=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    try:
        for i in range(required_frames):
            frame=frames[i];x1,y1,x2,y2=boxes[i]
            crop=cv2.resize(frame[y1:y2,x1:x2],(256,256))
            latent=pipe.get_latents_for_unet(crop);mx.eval(latent)
            recon=pipe.run_batched(latent,chunks[i:i+1],batch_size=1)[0]
            if i in data.get('diagnosticFrames',[]):
                cv2.imwrite(str(diagnostic_dir/f'{i:03d}-input.png'),crop)
                cv2.imwrite(str(diagnostic_dir/f'{i:03d}-model.png'),recon)
                cv2.imwrite(str(diagnostic_dir/f'{i:03d}-mask.png'),(masks[i][:,:,0]*255).round().astype(np.uint8))
                diagnostic_rows.append({'frame':i,'seconds':i/fps,'box':[x1,y1,x2,y2],'nativeCropSize':[x2-x1,y2-y1],'modelCropSize':[256,256]})
            recon=cv2.resize(recon,(x2-x1,y2-y1))
            mask=masks[i]
            frame[y1:y2,x1:x2]=(recon*mask+frame[y1:y2,x1:x2]*(1-mask)).astype(np.uint8)
            encoder.stdin.write(frame.tobytes())
            del latent,recon
            mx.clear_cache()
            if i%12==0:print(f'lip frames {i+1}/{len(chunks)}',flush=True)
        encoder.stdin.close()
        if encoder.wait()!=0:raise RuntimeError('Video encoding failed')
        probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(partial)],text=True))
        video_stream=next(s for s in probe['streams'] if s['codec_type']=='video')
        audio_stream=next(s for s in probe['streams'] if s['codec_type']=='audio')
        if int(video_stream.get('nb_frames',0))!=required_frames:
            raise RuntimeError('Encoded video lost speech frames')
        if float(audio_stream.get('duration',0))<duration-.005:
            raise RuntimeError('Encoded audio is truncated')
        partial.replace(out)
    finally:
        if encoder.poll() is None:encoder.kill();encoder.wait()
    receipt={'output':str(out),'frames':required_frames,'sourceAudio':data['audio'],'audioSeconds':duration,'fps':fps,'status':'EXPERIMENT_REQUIRES_REVIEW',
        'faceDetectionRegion':data.get('faceDetectionRegion',[0,0,1,1]),'singleSubjectVisualReview':data.get('singleSubjectVisualReview'),
        'preserveUpperLip':data.get('preserveUpperLip',False),
        'audioFeatureTiming':data.get('audioFeatureTiming','upstream'),
        'faceCropAnchor':data.get('faceCropAnchor','bridge-6'),
        'timing':'Original audio preserved; frontend-only zero padding covers final fractional frame; no video looping',
        'blend':'first-party bounded lip-only mask; jaw and cheeks preserved before encoding; review required'}
    Path(str(out)+'.evaluation.json').write_text(json.dumps(receipt,indent=2))
    if diagnostic_rows:(diagnostic_dir/'frames.json').write_text(json.dumps(diagnostic_rows,indent=2)+'\n')
    print(json.dumps(receipt),flush=True)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('request');parser.add_argument('--execute',action='store_true')
    args=parser.parse_args();request=Path(args.request).resolve();data=json.loads(request.read_text())
    validate_request(data)
    if args.execute:return execute(data)
    from media_resource_guard import bounded_media
    output=Path(data['output']);output.parent.mkdir(parents=True,exist_ok=True)
    os.environ.update({'HF_HUB_OFFLINE':'1','OMP_NUM_THREADS':'2','GLOG_minloglevel':'2'})
    signal.signal(signal.SIGTERM,lambda *_:sys.exit(130))
    stats=None
    try:
        with bounded_media([sys.executable,__file__,str(request),'--execute'],output.parent,
                max_rss_mb=16384,min_free_gb=20,minimum_available_gb=8,max_swap_growth_gb=1,
                timeout=900) as(p,stats):p.wait()
    finally:
        if stats is not None:Path(str(output)+'.resources.json').write_text(json.dumps(stats,indent=2))

if __name__=='__main__':main()
