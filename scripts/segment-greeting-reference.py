"""Derive control masks from annotated reference silhouettes; source is read-only."""
import argparse,hashlib,json
from pathlib import Path
import cv2
import numpy as np

p=argparse.ArgumentParser(description=__doc__);p.add_argument('annotation',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
d=json.loads(a.annotation.read_text());source=Path(d['reference']);assert hashlib.sha256(source.read_bytes()).hexdigest()==d['referenceSha256']
cv2.setNumThreads(2);image=cv2.imread(str(source));h,w=image.shape[:2];assert [w,h]==d['coordinateSize']
a.output.mkdir(parents=True,exist_ok=False);labels=np.zeros((h,w),np.uint8);rows=[]
for actor in d['actors']:
    polygon=np.zeros((h,w),np.uint8);cv2.fillPoly(polygon,[np.array(actor['silhouetteSeedPolygon'],np.int32)],255)
    outer=cv2.dilate(polygon,np.ones((13,13),np.uint8));inner=cv2.erode(polygon,np.ones((29,29),np.uint8))
    mask=np.full((h,w),cv2.GC_BGD,np.uint8);mask[outer>0]=cv2.GC_PR_BGD;mask[polygon>0]=cv2.GC_PR_FGD;mask[inner>0]=cv2.GC_FGD
    for seed in actor.get('foregroundPolygons',[]):cv2.fillPoly(mask,[np.array(seed,np.int32)],int(cv2.GC_FGD))
    cv2.grabCut(image,mask,None,np.zeros((1,65),np.float64),np.zeros((1,65),np.float64),5,cv2.GC_INIT_WITH_MASK)
    result=np.isin(mask,[cv2.GC_FGD,cv2.GC_PR_FGD]).astype(np.uint8)*255
    assert result.any() and not ((labels>0)&(result>0)).any();labels[result>0]=actor['labelId']
    cv2.imwrite(str(a.output/(actor['id']+'-native.png')),result)
    small=cv2.resize(result,(512,288),interpolation=cv2.INTER_NEAREST);cv2.imwrite(str(a.output/(actor['id']+'.png')),small)
    rows.append({'actorId':actor['id'],'pixels':int((result>0).sum()),'maskSha256':hashlib.sha256((a.output/(actor['id']+'.png')).read_bytes()).hexdigest()})
overlay=image.copy()
for actor in d['actors']:
    contours,_=cv2.findContours((labels==actor['labelId']).astype(np.uint8),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(overlay,contours,-1,(0,0,255) if actor['labelId']==1 else (0,255,0),3)
    for point in actor.get('wristTargets',{}).values():cv2.circle(overlay,tuple(point),6,(0,255,255),-1)
cv2.imwrite(str(a.output/'reference-contour-review.jpg'),overlay)
(a.output/'manifest.json').write_text(json.dumps({'status':'REFERENCE_MASKS_REQUIRE_VISUAL_REVIEW','referenceSha256':d['referenceSha256'],'actors':rows,'overlappingActorPixels':0,'productionApproved':False,'sourceImageModified':False},indent=2)+'\n')
print(json.dumps(rows))
