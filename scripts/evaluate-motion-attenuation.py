"""Experimental dense-flow video remapping. Never confers production approval."""
import argparse,json,subprocess
from pathlib import Path
import cv2
import numpy as np
from media_resource_guard import bounded_media
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--strength',type=float,required=True);a=p.parse_args()
out=Path(a.output)
if out.exists() or not .1<=a.strength<=.9:raise ValueError('New output and bounded strength required')
cv2.setNumThreads(1);cap=cv2.VideoCapture(a.input);n=int(cap.get(cv2.CAP_PROP_FRAME_COUNT));fps=cap.get(cv2.CAP_PROP_FPS);ok,first=cap.read()
if not ok or not 1<n<=65 or not 1<=fps<=30:raise ValueError('Short source required')
h,w=first.shape[:2]
if w*h>512*288:raise ValueError('Evaluation resolution capped')
gray=cv2.cvtColor(first,cv2.COLOR_BGR2GRAY);flow_engine=cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
yy,xx=np.mgrid[:h,:w].astype(np.float32);partial=out.with_suffix('.partial.mp4');metrics=[]
cmd=['ffmpeg','-v','error','-n','-filter_threads','1','-f','rawvideo','-pix_fmt','bgr24','-s',f'{w}x{h}','-r',str(fps),'-i','pipe:0','-an','-c:v','libx264','-threads','2','-crf','16','-pix_fmt','yuv420p',str(partial)]
with bounded_media(cmd,out.parent,stdin=subprocess.PIPE) as(proc,stats):
 for i in range(n):
  if i==0:frame=first
  else:
   ok,frame=cap.read()
   if not ok:raise ValueError('Truncated input')
  flow=flow_engine.calc(gray,cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY),None)
  if not np.isfinite(flow).all():raise ValueError('Invalid motion field')
  ux,uy=xx.copy(),yy.copy()
  for _ in range(16):
   local=cv2.remap(flow,ux,uy,cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
   ux=xx-a.strength*local[:,:,0];uy=yy-a.strength*local[:,:,1]
  local=cv2.remap(flow,ux,uy,cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
  residual=np.sqrt((ux+a.strength*local[:,:,0]-xx)**2+(uy+a.strength*local[:,:,1]-yy)**2)
  result=cv2.remap(frame,ux+local[:,:,0],uy+local[:,:,1],cv2.INTER_LINEAR,borderMode=cv2.BORDER_REPLICATE)
  metrics.append({'frame':i,'inverseResidualP99':float(np.percentile(residual,99)),'maximumFlowPixels':float(np.linalg.norm(flow,axis=2).max())})
  proc.stdin.write(result.tobytes())
 cap.release();proc.stdin.close();proc.wait()
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(partial)],text=True))
if int(probe['streams'][0]['nb_frames'])!=n:raise ValueError('Changed frame count')
partial.replace(out)
receipt={'status':'EXPERIMENT_NOT_APPROVED','source':a.input,'frames':n,'fps':fps,'strength':a.strength,'method':'DIS first-frame-relative forward flow; fixed-point inverse of attenuated displacement; resample current source frame','limitations':['not pose conditioning','occlusion, folds and face warps may invalidate result','strength is not a certified physical angle','no identity or hand-continuity guarantee'],'resources':stats,'metrics':metrics}
out.with_suffix('.evaluation.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps({'frames':n,'maxInverseResidualP99':max(x['inverseResidualP99'] for x in metrics)}))
