"""Restore a declared empty edge from its clean first frame; retain all real frames.

Only for a locked camera and a region proven separate from intended characters.
No temporal extension, frame cycling, face replacement or motion interpolation.
"""
import argparse,json,subprocess
from pathlib import Path
import cv2
import numpy as np
from media_resource_guard import bounded_media
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--edge',type=float,required=True);p.add_argument('--feather',type=int,default=12);p.add_argument('--side',choices=['left','right'],default='left');p.add_argument('--clean-source');a=p.parse_args()
source=Path(a.input);out=Path(a.output);out.parent.mkdir(parents=True,exist_ok=True)
if out.exists() or not 0<a.edge<=.3 or not 1<=a.feather<=24:raise ValueError('Invalid bounded empty-edge repair')
cv2.setNumThreads(1);cap=cv2.VideoCapture(str(source));fps=cap.get(cv2.CAP_PROP_FPS);count=int(cap.get(cv2.CAP_PROP_FRAME_COUNT));ok,clean=cap.read()
if not ok or not 0<count<=150 or not 0<fps<=30:raise ValueError('Bounded readable short video required')
first=clean.copy()
if a.clean_source:
 clean_cap=cv2.VideoCapture(a.clean_source);valid,clean=clean_cap.read();clean_cap.release()
 if not valid or clean.shape!=first.shape:raise ValueError('Clean plate dimensions differ')
h,w=clean.shape[:2]
if w*h>1280*720:raise ValueError('Frame too large')
edge=round(w*a.edge)
if edge<=a.feather:raise ValueError('Repair edge too narrow')
alpha=np.ones((h,edge,1),np.float32)
if a.side=='left':
 start,stop=0,edge;alpha[:,-a.feather:,0]=np.linspace(1,0,a.feather)
else:
 start,stop=w-edge,w;alpha[:,:a.feather,0]=np.linspace(0,1,a.feather)
partial=out.with_suffix('.partial.mp4');written=0
cmd=['ffmpeg','-v','error','-n','-filter_threads','1','-f','rawvideo','-pix_fmt','bgr24','-s',f'{w}x{h}','-r',str(fps),'-i','pipe:0','-an','-c:v','libx264','-threads','2','-crf','16','-pix_fmt','yuv420p','-movflags','+faststart',str(partial)]
with bounded_media(cmd,out.parent,stdin=subprocess.PIPE) as(proc,stats):
 frame=first
 for index in range(count):
  if index:
   ok,frame=cap.read()
   if not ok:raise ValueError('Incomplete source decode')
  original_subject=frame.copy()
  frame[:,start:stop]=(clean[:,start:stop]*alpha+frame[:,start:stop]*(1-alpha)).astype(np.uint8)
  if not np.array_equal(frame[:,:start],original_subject[:,:start]) or not np.array_equal(frame[:,stop:],original_subject[:,stop:]):raise ValueError('Repair modified protected subject region')
  proc.stdin.write(frame.tobytes());written+=1
 cap.release();proc.stdin.close();proc.wait()
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(partial)],text=True));video=next(s for s in probe['streams'] if s['codec_type']=='video')
if int(video['nb_frames'])!=count:raise ValueError('Repair changed frame count')
partial.replace(out)
receipt={'source':str(source),'output':str(out),'frames':written,'fps':fps,'repairRegionNormalized':[start/w,0,stop/w,1],'cleanSource':a.clean_source or a.input,'featherPixels':a.feather,'protectedSubjectPixelsUnchangedBeforeEncoding':True,'method':'same-shot first-frame clean plate in verified empty edge only','noFrameLoopingOrDurationExtension':True,'resources':stats,'status':'REQUIRES_VISUAL_EDGE_AND_SUBJECT_REVIEW'};out.with_suffix('.repair.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt))
