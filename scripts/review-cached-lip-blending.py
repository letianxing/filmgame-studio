"""Bounded video-frame QA using cached reconstructions; no model inference.

Produces a diagnostic contact sheet, never production media. Lower-face mask
is intentionally a probe: it is not semantic face parsing or a shipping blend.
"""
import argparse
import json
from pathlib import Path
import cv2
import numpy as np


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--diagnostics',required=True)
    p.add_argument('--video',required=True)
    p.add_argument('--output-dir',required=True)
    a=p.parse_args()
    source=Path(a.diagnostics);out=Path(a.output_dir)
    rows=json.loads((source/'frames.json').read_text())
    if not 1<=len(rows)<=8:raise ValueError('Bounded diagnostic frames required')
    out.mkdir(exist_ok=False)
    cv2.setNumThreads(2)
    cap=cv2.VideoCapture(a.video);sheets=[];measurements=[]
    try:
        for row in rows:
            i=row['frame'];x1,y1,x2,y2=row['box']
            cap.set(cv2.CAP_PROP_POS_FRAMES,i);ok,frame=cap.read()
            if not ok:raise ValueError('Missing source frame')
            original=frame[y1:y2,x1:x2].copy();h,w=original.shape[:2]
            model=cv2.imread(str(source/f'{i:03d}-model.png'))
            mask=cv2.imread(str(source/f'{i:03d}-mask.png'),cv2.IMREAD_GRAYSCALE)
            if model is None or mask is None or mask.shape!=(h,w):raise ValueError('Invalid cache')
            model=cv2.resize(model,(w,h))
            tight=mask.astype(np.float32)/255
            ys,xs=np.where(mask>127)
            if len(xs)==0:raise ValueError('Empty source mask')
            # Probe encompasses lips and surrounding lower face, with a smooth
            # ellipse taper. Keep upper face outside the support region.
            cx=float(xs.mean());cy=float(ys.mean())+h*.035
            rx=max((xs.max()-xs.min())*.95,w*.30);ry=h*.19
            yy,xx=np.mgrid[:h,:w]
            radius=np.sqrt(((xx-cx)/rx)**2+((yy-cy)/ry)**2)
            wide=np.clip((1-radius)/.30,0,1).astype(np.float32)
            panels=[]
            for label,m in [('source',np.zeros_like(tight)),('lip only',tight),('wide probe',wide)]:
                blend=(model*m[:,:,None]+original*(1-m[:,:,None])).round().astype(np.uint8)
                context=frame.copy();context[y1:y2,x1:x2]=blend
                crop=context[max(0,y1-10):min(frame.shape[0],y2+15),max(0,x1-15):min(frame.shape[1],x2+15)]
                panel=cv2.resize(crop,(240,300));cv2.putText(panel,label,(8,20),cv2.FONT_HERSHEY_SIMPLEX,.5,(255,255,255),1)
                panels.append(panel)
            sheets.append(np.hstack(panels))
            measurements.append({'frame':i,'seconds':row['seconds'],'tightSupportPixels':int((tight>0).sum()),'probeSupportPixels':int((wide>0).sum())})
        cv2.imwrite(str(out/'comparison.png'),np.vstack(sheets))
        (out/'receipt.json').write_text(json.dumps({'status':'DIAGNOSTIC_ONLY_NOT_PRODUCTION','sourceVideo':a.video,'cache':a.diagnostics,'columns':['source','lip only','wide probe'],'frames':measurements,'limitations':['Static sampled frames cannot establish temporal coherence or lip synchronization.','Wide mask has no beard or face semantic segmentation.']},indent=2)+'\n')
    finally:cap.release()


if __name__=='__main__':main()
