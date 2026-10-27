"""Bounded expression-transfer evaluation via original LivePortrait public APIs.

Uses safetensors loader and MediaPipe face boxes; no InsightFace weights, no upstream edits.
Outputs an explicitly cropped silent technical comparison, not a finished scene.
"""
import json,os,signal,subprocess,sys
from pathlib import Path
from media_resource_guard import bounded_media

def execute(d):
    import cv2,numpy as np,torch,mediapipe as mp
    from safetensors.torch import load_file
    torch.set_num_threads(2);cv2.setNumThreads(2)
    sys.path.insert(0,d['upstream'])
    from src import live_portrait_wrapper as api
    from src.config.inference_config import InferenceConfig
    from src.utils import helper
    classes={'appearance_feature_extractor':helper.AppearanceFeatureExtractor,
             'motion_extractor':helper.MotionExtractor,'warping_module':helper.WarpingNetwork,
             'spade_generator':helper.SPADEDecoder}
    def safe_loader(path,config,device,kind):
        model=classes[kind](**config['model_params'][kind+'_params'])
        model.load_state_dict(load_file(path),strict=True)
        return model.eval().to(device)
    api.load_model=safe_loader
    weights=Path(d['modelDir'])
    cfg=InferenceConfig(checkpoint_F=str(weights/'appearance_feature_extractor.safetensors'),
        checkpoint_M=str(weights/'motion_extractor.safetensors'),
        checkpoint_W=str(weights/'warping_module.safetensors'),
        checkpoint_G=str(weights/'spade_generator.safetensors'),checkpoint_S=None,
        flag_use_half_precision=False,flag_do_torch_compile=False,flag_stitching=False)
    model=api.LivePortraitWrapper(cfg)
    detector=mp.solutions.face_mesh.FaceMesh(static_image_mode=True,max_num_faces=2,min_detection_confidence=.5)
    def box_for(frame):
        found=detector.process(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB)).multi_face_landmarks
        if not found or len(found)!=1:raise ValueError('Need exactly one detectable face')
        h,w=frame.shape[:2];pts=np.array([(p.x*w,p.y*h) for p in found[0].landmark])
        lo,hi=pts.min(0),pts.max(0);center=(lo+hi)/2
        side=min(max(hi-lo)*1.65,w,h);center[1]-=side*.08
        x=int(np.clip(center[0]-side/2,0,w-side));y=int(np.clip(center[1]-side/2,0,h-side))
        return x,y,int(side)
    def prep(frame,box):
        x,y,s=box;crop=frame[y:y+s,x:x+s]
        return model.prepare_source(cv2.cvtColor(cv2.resize(crop,(256,256)),cv2.COLOR_BGR2RGB))
    source=cv2.imread(d['source']);source_box=box_for(source);s=prep(source,source_box)
    cap=cv2.VideoCapture(d['driving']);fps=cap.get(cv2.CAP_PROP_FPS)
    if not 1<=fps<=30:raise ValueError('Unsupported driving fps')
    ok,frame=cap.read()
    if not ok:raise ValueError('Missing driving video')
    driving_box=box_for(frame)
    source_info=model.get_kp_info(s);source_kp=model.transform_keypoint(source_info)
    feature=model.extract_feature_3d(s);initial=model.get_kp_info(prep(frame,driving_box))
    out=Path(d['output']);partial=out.with_suffix('.partial.mp4')
    cmd=['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s','512x512','-r',str(fps),
         '-i','pipe:0','-an','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-crf','18',str(partial)]
    encoder=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    try:
        for i in range(d['frames']):
            if not ok:raise ValueError('Source clip shorter than requested; never loop')
            info=model.get_kp_info(prep(frame,driving_box))
            adjusted={k:v.clone() for k,v in source_info.items()}
            adjusted['exp']=source_info['exp']+d['expressionScale']*(info['exp']-initial['exp'])
            driven=model.transform_keypoint(adjusted)
            result=model.warp_decode(feature,source_kp,driven)
            pixels=model.parse_output(result['out'])[0]
            encoder.stdin.write(pixels.tobytes())
            if i%8==0:print(f'LivePortrait {i+1}/{d["frames"]}',flush=True)
            ok,frame=cap.read()
        encoder.stdin.close()
        if encoder.wait()!=0:raise RuntimeError('Encoding failed')
        partial.replace(out)
    finally:
        cap.release();detector.close()
        if encoder.poll() is None:encoder.kill();encoder.wait()
    Path(str(out)+'.evaluation.json').write_text(json.dumps({'sourceBox':source_box,'drivingBox':driving_box,
        'expressionScale':d['expressionScale'],'pose':'locked to source','stitching':False,'audio':False,
        'status':'CANDIDATE_REQUIRES_REVIEW'},indent=2))

if __name__=='__main__':
    request=Path(sys.argv[1]).resolve();d=json.loads(request.read_text());out=Path(d['output'])
    if out.exists():raise ValueError('Refusing overwrite')
    if not 1<=d['frames']<=49 or not 0<=d['expressionScale']<=.5:raise ValueError('Unsafe evaluation profile')
    if '--execute' in sys.argv:execute(d)
    else:
        out.parent.mkdir(parents=True,exist_ok=True)
        os.environ.update({'PYTORCH_ENABLE_MPS_FALLBACK':'1','PYTORCH_MPS_HIGH_WATERMARK_RATIO':'0.4','PYTORCH_MPS_LOW_WATERMARK_RATIO':'0.3',
                           'OMP_NUM_THREADS':'2','GLOG_minloglevel':'2'})
        signal.signal(signal.SIGTERM,lambda *_:sys.exit(130))
        stats=None
        try:
            with bounded_media([sys.executable,__file__,str(request),'--execute'],out.parent,
                    max_rss_mb=12288,minimum_available_gb=8,max_swap_growth_gb=1,min_free_gb=20,timeout=900) as(p,stats):p.wait()
        finally:
            if stats is not None:Path(str(out)+'.resources.json').write_text(json.dumps(stats,indent=2))
