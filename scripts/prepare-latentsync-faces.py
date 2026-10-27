"""Bounded real-video face alignment; no loops, generated motion or model weights.

MediaPipe landmarks are a candidate replacement for upstream InsightFace,
not asserted to be landmark-equivalent. Save reversible transforms for review.
"""
import argparse,json,hashlib,math
from pathlib import Path


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--video',required=True);p.add_argument('--audio-metadata',required=True);p.add_argument('--output-dir',required=True)
    a=p.parse_args();out=Path(a.output_dir)
    if out.exists():raise ValueError('Output exists')
    import cv2,mediapipe as mp,numpy as np
    from face_alignment_geometry import similarity_transform,transform_points
    cv2.setNumThreads(2)
    meta=json.loads(Path(a.audio_metadata).read_text());count=meta['frames25fps']
    if not 1<=count<=100 or count!=math.ceil(meta['samples16kHz']*25/16000):raise ValueError('Invalid audio duration')
    cap=cv2.VideoCapture(a.video)
    if abs(cap.get(cv2.CAP_PROP_FPS)-25)>.001 or cap.get(cv2.CAP_PROP_FRAME_COUNT)<count:
        raise ValueError('Need enough real 25fps frames; never loop or reverse')
    out.mkdir();originals=[];faces=[];matrices=[];records=[]
    # Upstream alignment template is 420x560 at resolution 512, then resized.
    template=np.array([[17,20],[58,20],[37.5,40]],np.float64)*5.6
    with mp.solutions.face_mesh.FaceMesh(static_image_mode=True,max_num_faces=2,min_detection_confidence=.5) as detector:
        for i in range(count):
            ok,frame=cap.read()
            if not ok:raise ValueError('Incomplete source video')
            h,w=frame.shape[:2]
            if h*w>1280*720:raise ValueError('Frame exceeds bounded profile')
            found=detector.process(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB)).multi_face_landmarks
            if not found or len(found)!=1:raise ValueError(f'Expected one face at {i}')
            points=np.array([(v.x*w,v.y*h) for v in found[0].landmark])
            anchors=np.array([points[[33,133]].mean(0),points[[362,263]].mean(0),points[1]])
            if anchors[0,0]>=anchors[1,0]:raise ValueError('Mirrored or extreme face pose')
            matrix=similarity_transform(anchors,template)
            inverse=cv2.invertAffineTransform(matrix)
            roundtrip=np.max(np.abs(transform_points(transform_points(anchors,matrix),inverse)-anchors))
            fit=np.linalg.norm(transform_points(anchors,matrix)-template,axis=1).max()
            if roundtrip>1e-6 or fit>40:raise ValueError('Face transform failed geometry check')
            aligned=cv2.warpAffine(frame,matrix,(420,560),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_CONSTANT,borderValue=(127,127,127))
            faces.append(cv2.resize(aligned,(512,512),interpolation=cv2.INTER_LINEAR));originals.append(frame);matrices.append(matrix)
            records.append({'frame':i,'seconds':i/25,'sourceAnchors':anchors.tolist(),'fitMaxPixels':float(fit),'roundtripMaxPixels':float(roundtrip),'nativeFaceWidth':float(np.ptp(points[:,0]))})
    cap.release()
    np.savez(out/'faces.npz',faces=np.stack(faces),originals=np.stack(originals),matrices=np.stack(matrices))
    cv2.imwrite(str(out/'alignment-contact.png'),np.hstack([faces[i] for i in [0,count//2,count-1]]))
    (out/'manifest.json').write_text(json.dumps({'status':'CANDIDATE_ALIGNMENT_REQUIRES_REVIEW','sourceVideo':a.video,'sourceSha256':hashlib.sha256(Path(a.video).read_bytes()).hexdigest(),'fps':25,'frames':count,'faceColor':'BGR','alignedCanvas':[420,560],'modelSize':[512,512],'records':records,'limitations':['MediaPipe anchors differ from upstream detector.','Resizing does not recover native face detail.','Source head motion and acting are unchanged.']},indent=2)+'\n')


if __name__=='__main__':main()
