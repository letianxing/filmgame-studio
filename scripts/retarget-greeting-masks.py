"""Propagate reference label masks along calibrated projected proxy landmarks."""
import argparse,copy,json,os
os.environ.setdefault('OPENBLAS_NUM_THREADS','2');os.environ.setdefault('OMP_NUM_THREADS','2')
from pathlib import Path
import cv2,numpy as np
from scipy.interpolate import RBFInterpolator

p=argparse.ArgumentParser(description=__doc__);p.add_argument('controls',type=Path);p.add_argument('annotation',type=Path);p.add_argument('masks',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
cv2.setNumThreads(2);d=json.loads(a.controls.read_text());annotation=json.loads(a.annotation.read_text());w,h=d['size'];assert [w,h]==[512,288]
a.output.mkdir(parents=True,exist_ok=False);first={x['actorId']:np.array(x['body18'],np.float64) for x in d['samples'][0]['actors']};offsets={k:np.zeros((18,2)) for k in first}
for actor in annotation['actors']:
    for side,xy in actor.get('wristTargets',{}).items():
        index=d['body18Order'].index(side+'_wrist');target=np.array(xy)*[w/annotation['coordinateSize'][0],h/annotation['coordinateSize'][1]]
        offsets[actor['id']][index]=target-first[actor['id']][index,:2]
source_masks={name:cv2.imread(str(a.masks/(name+'.png')),cv2.IMREAD_GRAYSCALE) for name in first}
for name,mask in source_masks.items():
    assert mask is not None and mask.shape==(h,w) and set(np.unique(mask))<={0,255}
    (a.output/name).mkdir()
corners=np.array([[0,0],[w-1,0],[0,h-1],[w-1,h-1]],np.float64)
yy,xx=np.mgrid[:h,:w];grid=np.column_stack([xx.ravel(),yy.ravel()]);records=[]
updated=copy.deepcopy(d)
for row in updated['samples']:
    occupied=np.zeros((h,w),bool);frame_record={'frame':row['frame'],'actors':[]}
    for actor in row['actors']:
        name=actor['actorId'];points=np.array(actor['body18'],np.float64);points[:,:2]+=offsets[name];actor['body18']=points.tolist()
        start=np.vstack([first[name][:,:2]+offsets[name],corners]);target=np.vstack([points[:,:2],corners])
        if row['frame']==0:mask=source_masks[name].copy()
        else:
            inverse=RBFInterpolator(target,start,kernel='thin_plate_spline',degree=1,smoothing=0)
            mapped=np.concatenate([inverse(grid[i:i+4096]) for i in range(0,len(grid),4096)]).astype(np.float32).reshape(h,w,2)
            mask=cv2.remap(source_masks[name],mapped[:,:,0],mapped[:,:,1],cv2.INTER_NEAREST,borderMode=cv2.BORDER_CONSTANT)
        active=mask>0;ratio=float(active.sum()/max(1,(source_masks[name]>0).sum()));assert .65<ratio<1.35
        assert not (occupied&active).any();occupied|=active
        cv2.imwrite(str(a.output/name/f'{row["frame"]:03d}.png'),cv2.cvtColor(mask,cv2.COLOR_GRAY2RGB))
        frame_record['actors'].append({'actorId':name,'labelId':actor['labelId'],'areaRatio':ratio,'pixels':int(active.sum())})
    records.append(frame_record)
updated.update(status='REFERENCE_ALIGNED_PROXY_CONTROLS_REQUIRE_MOTION_REVIEW',referenceAnnotation=str(a.annotation),referenceMasks=str(a.masks),wristCorrectionPixels={k:v.tolist() for k,v in offsets.items()},productionApproved=False)
updated['limitations']+=['Mask propagation is a 2D control-region warp, not physical cloth simulation or final image animation.','Only host wrists are recalibrated to observed reference coordinates; other body landmarks remain geometric proxies.']
(a.output/'actor-controls.json').write_text(json.dumps(updated,ensure_ascii=False,indent=2)+'\n')
(a.output/'verification.json').write_text(json.dumps({'status':'49_FRAME_MASK_PROPAGATION_CHECKED_NOT_PRODUCTION_APPROVAL','frames':len(records),'referenceFrameMasksExact':True,'overlappingActorPixels':0,'records':records,'productionApproved':False},indent=2)+'\n')
print('Propagated',len(records),'frames for',len(first),'actors')
