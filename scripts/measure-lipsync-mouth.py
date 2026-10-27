"""Paired frame mouth geometry diagnostics; never a perceptual sync verdict."""
import argparse,json,math
from pathlib import Path


def main():
    p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--candidate',required=True);p.add_argument('--output',required=True)
    a=p.parse_args();out=Path(a.output)
    if out.exists():raise ValueError('Output exists')
    import cv2,numpy as np,mediapipe as mp
    cv2.setNumThreads(2)
    caps=[cv2.VideoCapture(path) for path in [a.source,a.candidate]]
    fps=[cap.get(cv2.CAP_PROP_FPS) for cap in caps];counts=[int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) for cap in caps]
    if abs(fps[0]-fps[1])>.001 or not 1<=counts[1]<=100 or counts[0]<counts[1]:raise ValueError('Require bounded matching timelines')
    rows=[]
    with mp.solutions.face_mesh.FaceMesh(static_image_mode=True,max_num_faces=2,min_detection_confidence=.5) as detector:
        for i in range(counts[1]):
            row={'frame':i,'seconds':i/fps[1]}
            for label,cap in zip(['source','candidate'],caps):
                ok,frame=cap.read()
                if not ok:raise ValueError('Incomplete video')
                if frame.shape[0]*frame.shape[1]>1280*720:raise ValueError('Unbounded frame size')
                found=detector.process(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB)).multi_face_landmarks
                if not found or len(found)!=1:row[label]={'status':'UNMEASURABLE'};continue
                points=np.array([(v.x*frame.shape[1],v.y*frame.shape[0]) for v in found[0].landmark])
                width=np.linalg.norm(points[61]-points[291]);opening=np.linalg.norm(points[13]-points[14])
                row[label]={'status':'MEASURED','mouthWidthPixels':float(width),'innerLipOpeningPixels':float(opening),'openingToWidth':float(opening/max(width,1e-8))}
            rows.append(row)
    for cap in caps:cap.release()
    summaries={}
    for label in ['source','candidate']:
        values=[r[label]['openingToWidth'] for r in rows if r[label]['status']=='MEASURED']
        summaries[label]={'measuredFrames':len(values),'minOpeningRatio':min(values) if values else None,'maxOpeningRatio':max(values) if values else None}
    boundaries=[]
    for index in [16,32]:
        if index>=len(rows):continue
        pair={'frame':index}
        for label in ['source','candidate']:
            before,after=rows[index-1][label],rows[index][label]
            pair[label+'OpeningRatioDelta']=after['openingToWidth']-before['openingToWidth'] if before['status']==after['status']=='MEASURED' else None
        boundaries.append(pair)
    out.write_text(json.dumps({'status':'GEOMETRY_DIAGNOSTIC_NOT_LIPSYNC_ACCEPTANCE','source':a.source,'candidate':a.candidate,'fps':fps[1],'frames':rows,'summary':summaries,'chunkBoundaries':boundaries,'limitations':['Landmark estimates can jitter or fail on stylized low-resolution faces.','Mouth opening alone cannot establish pronunciation, emotion, identity or audio synchronization.','Small boundary deltas do not prove temporal continuity.']},indent=2)+'\n')


if __name__=='__main__':main()
