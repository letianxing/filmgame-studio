"""Extract reference face meshes from fixed actor ROIs without changing pixels."""
import argparse,hashlib,json
from pathlib import Path
import cv2,mediapipe as mp,numpy as np

p=argparse.ArgumentParser(description=__doc__);p.add_argument('reference',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
cv2.setNumThreads(2);image=cv2.imread(str(a.reference));assert image is not None and image.shape[:2]==(941,1672)
a.output.mkdir(parents=True,exist_ok=False);rows=[];panels=[]
rois={'zhang-zhao':[390,60,570,250],'kongming':[1120,30,1320,240]}
with mp.solutions.face_mesh.FaceMesh(static_image_mode=True,max_num_faces=1,refine_landmarks=True,min_detection_confidence=.5) as detector:
    for name,(x0,y0,x1,y1) in rois.items():
        crop=image[y0:y1,x0:x1];large=cv2.resize(crop,None,fx=3,fy=3,interpolation=cv2.INTER_CUBIC)
        found=detector.process(cv2.cvtColor(large,cv2.COLOR_BGR2RGB)).multi_face_landmarks
        if not found or len(found)!=1:raise RuntimeError('No unique reference face for '+name)
        points=np.array([[p.x*(x1-x0)+x0,p.y*(y1-y0)+y0,p.z*(x1-x0)] for p in found[0].landmark])
        if not np.isfinite(points).all():raise ValueError('Invalid landmarks')
        marked=large.copy()
        for index,point in enumerate(points[:468]):
            xx=int((point[0]-x0)*3);yy=int((point[1]-y0)*3);cv2.circle(marked,(xx,yy),1,(0,255,0),-1)
        cv2.putText(marked,name,(8,20),cv2.FONT_HERSHEY_SIMPLEX,.6,(0,255,255),1)
        cv2.imwrite(str(a.output/(name+'-mesh-review.png')),marked)
        rows.append({'actorId':name,'roi':[x0,y0,x1,y1],'landmarks':points.tolist(),'rightEyeCenter':points[[33,133],:2].mean(0).tolist(),'leftEyeCenter':points[[362,263],:2].mean(0).tolist(),'nose':points[1,:2].tolist()})
report={'status':'REFERENCE_FACE_MESH_DETECTED_REQUIRES_REVIEW','reference':str(a.reference),'referenceSha256':hashlib.sha256(a.reference.read_bytes()).hexdigest(),'size':[1672,941],'actors':rows,'productionApproved':False,'limitations':['MediaPipe mesh is not equivalent to DWPose/dlib face68.','Occluded features are inferred; no facial-motion or pronunciation acceptance.','ROI upscaling helps detection but adds no native image detail.']}
(a.output/'faces.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print('Detected reference meshes for',len(rows),'actors')
