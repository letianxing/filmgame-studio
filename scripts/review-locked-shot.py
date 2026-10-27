"""Measure first-frame-relative motion in declared static architecture regions.
Diagnostic only: low displacement does not certify face identity or film quality.
"""
import argparse,json
from pathlib import Path
import cv2
import numpy as np

p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--regions',required=True);p.add_argument('--reference-frame',type=int,default=0);args=p.parse_args()
cv2.setNumThreads(1)
out=Path(args.output)
if out.exists():raise ValueError('Refusing to overwrite drift evidence')
cap=cv2.VideoCapture(args.input);count=int(cap.get(cv2.CAP_PROP_FRAME_COUNT));fps=cap.get(cv2.CAP_PROP_FPS)
if not 0<count<=150 or not 0<fps<=30:raise ValueError('Bounded short takes only')
if not 0<=args.reference_frame<count-1:raise ValueError('Invalid reference frame')
for _ in range(args.reference_frame):
 if not cap.read()[0]:raise ValueError('Incomplete prefix decode')
ok,first=cap.read()
if not ok:raise ValueError('Missing first frame')
h,w=first.shape[:2]
if w*h>1280*720:raise ValueError('Review resolution exceeds bounded profile')
gray=cv2.cvtColor(first,cv2.COLOR_BGR2GRAY);regions=json.loads(Path(args.regions).read_text());features={}
for name,box in regions.items():
 x1,y1,x2,y2=box
 if not 0<=x1<x2<=1 or not 0<=y1<y2<=1:raise ValueError('Invalid normalized static region')
 mask=np.zeros((h,w),np.uint8);mask[round(y1*h):round(y2*h),round(x1*w):round(x2*w)]=255
 points=cv2.goodFeaturesToTrack(gray,maxCorners=80,qualityLevel=.015,minDistance=4,mask=mask)
 if points is None or len(points)<8:raise ValueError('Insufficient static features: '+name)
 features[name]=points
rows=[]
for i in range(args.reference_frame+1,count):
 ok,frame=cap.read()
 if not ok:raise ValueError('Incomplete decode')
 current=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY);metrics={}
 for name,points in features.items():
  tracked,status,error=cv2.calcOpticalFlowPyrLK(gray,current,points,None,winSize=(21,21),maxLevel=3)
  back,backstatus,_=cv2.calcOpticalFlowPyrLK(current,gray,tracked,None,winSize=(21,21),maxLevel=3)
  good=(status.ravel()==1)&(backstatus.ravel()==1)&(np.linalg.norm(back.reshape(-1,2)-points.reshape(-1,2),axis=1)<1)
  if good.sum()<8:metrics[name]={'status':'UNRESOLVED','tracked':int(good.sum())};continue
  delta=tracked.reshape(-1,2)[good]-points.reshape(-1,2)[good]
  med=np.median(delta,axis=0)
  metrics[name]={'tracked':int(good.sum()),'medianDx':float(med[0]),'medianDy':float(med[1]),'medianDisplacement':float(np.median(np.linalg.norm(delta,axis=1)))}
 rows.append({'frame':i,'seconds':i/fps,'regions':metrics})
cap.release()
values=[m['medianDisplacement'] for row in rows for m in row['regions'].values() if 'medianDisplacement'in m]
unresolved=sum('medianDisplacement'not in m for row in rows for m in row['regions'].values())
report={'video':args.input,'width':w,'height':h,'fps':fps,'decodedFrames':count,'referenceFrame':args.reference_frame,'excludedPrefixFrames':args.reference_frame,'staticRegions':regions,'maximumMedianDisplacementPixels':max(values,default=None),'unresolvedRegionFrames':unresolved,'diagnosticFlag':'REVIEW_DRIFT' if unresolved or max(values,default=999)>2 else 'NO_LARGE_STATIC_REGION_MOTION_DETECTED','notApproval':'Does not measure source-frame identity, face drift, lip sync, acting or final visual quality; excluded prefix remains unapproved','frames':rows}
out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='frames'}))
