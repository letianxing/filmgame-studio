"""Add reference-derived facial curves to authored Body18 control frames."""
import argparse,ast,hashlib,json,math
from pathlib import Path
import cv2,numpy as np
from PIL import Image,ImageDraw
from face_alignment_geometry import similarity_transform,transform_points

p=argparse.ArgumentParser(description=__doc__);p.add_argument('pack',type=Path);p.add_argument('faces',type=Path);p.add_argument('renderer',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
pack=json.loads(a.pack.read_text());old=json.loads(Path(pack['integrityManifest']).read_text());controls=json.loads(Path(old['landmarkSource']).read_text());faces=json.loads(a.faces.read_text());assert faces['referenceSha256']==pack['referenceSha256']
lookup={x['actorId']:x for x in faces['actors']};order=pack['actorOrder'];w,h=pack['size'];native_w,native_h=faces['size']
source=json.loads((a.renderer/'source.json').read_text());raw=(a.renderer/'util.py').read_bytes();assert hashlib.sha256(raw).hexdigest()==source['sha256']
functions=[n for n in ast.parse(raw).body if isinstance(n,ast.FunctionDef) and n.name in ['draw_bodypose','draw_facepose']];assert len(functions)==2
scope={'np':np,'cv2':cv2,'math':math,'eps':.01};exec(compile(ast.Module(body=functions,type_ignores=[]),str(a.renderer/'util.py'),'exec'),scope)
# Anatomical curve selection, not a claim of equivalence to a trained face68 detector.
selection=[234,93,132,58,172,136,150,149,152,378,379,365,397,288,361,323,454,70,63,105,66,107,336,296,334,293,300,168,6,197,1,98,97,2,326,327,33,160,158,133,153,144,362,385,387,263,373,380,61,40,37,0,267,270,291,321,314,17,84,91,78,81,13,311,308,402,14,178]
assert len(selection)==68 and len(set(selection))==68
a.output.mkdir(parents=True,exist_ok=False);first={x['actorId']:np.array(x['body18'])[:,:2] for x in controls['samples'][0]['actors']};hashes=[];records=[]
for row in controls['samples']:
    bodies=[];curves=[];frame_record={'frame':row['frame'],'actors':[]}
    for actor in row['actors']:
        name=actor['actorId'];body=np.array(actor['body18'])[:,:2].copy();matrix=similarity_transform(first[name][[0,14,15]],body[[0,14,15]])
        face=lookup[name];mesh=np.array(face['landmarks'])[:,:2]*[w/native_w,h/native_h]
        curve=transform_points(mesh[selection],matrix)
        head=transform_points(np.array([face['nose'],face['rightEyeCenter'],face['leftEyeCenter']])*[w/native_w,h/native_h],matrix)
        body[[0,14,15]]=head;bodies.append(body/[w,h]);curves.append(curve/[w,h])
        scale=float(np.hypot(matrix[0,0],matrix[1,0]));rotation=float(np.degrees(np.arctan2(matrix[1,0],matrix[0,0])));assert .8<scale<1.2 and abs(rotation)<15
        with Image.open(Path(pack['maskDirectories'][name])/f'{row["frame"]:03d}.png') as im:mask=np.array(im.convert('L'))
        expanded=cv2.dilate(mask,np.ones((7,7),np.uint8));xy=np.rint(curve).astype(int);assert ((xy>=[0,0])&(xy<[w,h])).all()
        inside=float(np.mean(expanded[xy[:,1],xy[:,0]]>0));assert inside>.95
        frame_record['actors'].append({'actorId':name,'face68':curve.tolist(),'body18XY':body.tolist(),'hiddenBodyJoints':['right_ear','left_ear'],'scale':scale,'inPlaneRotationDegrees':rotation,'facePointsInsideDilatedMaskFraction':inside})
    points=np.concatenate(bodies);subset=np.arange(len(points)).reshape(len(order),18);subset[:,16:18]=-1
    # Render at original reference resolution, then resize as the upstream demo does.
    canvas=np.zeros((native_h,native_w,3),np.uint8);canvas=scope['draw_bodypose'](canvas,points,subset);canvas=scope['draw_facepose'](canvas,curves)
    image=Image.fromarray(canvas).resize((w,h),Image.Resampling.BILINEAR);target=a.output/f'{row["frame"]:03d}.png';image.save(target);hashes.append(hashlib.sha256(target.read_bytes()).hexdigest());records.append(frame_record)
(a.output/'reference-pose.png').write_bytes((a.output/'000.png').read_bytes())
manifest={**old,'poseSha256':hashes,'landmarkSource':str(a.faces),'bodyMotionSource':str(Path(old['landmarkSource'])),'nativeDrawingSize':[native_w,native_h],'faceSelectionIndices':selection,'hiddenBodyJoints':['right_ear','left_ear'],'productionApproved':False,'limitations':['MediaPipe-based anatomical face68 selection is approximate, not detector-equivalent.','Reference expression is held while following 2D head motion; not audio-driven lip sync.','Ears are omitted because the face mesh does not measure them.','No hand21 control or generated-media acceptance.']};(a.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(a.output/'face-motion.json').write_text(json.dumps({'status':'REFERENCE_FACIAL_CONTROL_REQUIRES_REVIEW','frames':records,'productionApproved':False},indent=2)+'\n')
sheet=Image.new('RGB',(w*3,h+24),'#111111');draw=ImageDraw.Draw(sheet)
for i,frame in enumerate([0,24,48]):
    with Image.open(a.output/f'{frame:03d}.png') as im:sheet.paste(im,(i*w,0))
    draw.text((i*w+5,h+5),f'frame {frame}',fill='white')
sheet.save(a.output/'contact.jpg',quality=95)
new={**pack,'poseDirectory':str(a.output),'referencePose':str(a.output/'reference-pose.png'),'integrityManifest':str(a.output/'manifest.json'),'status':'REFERENCE_FACIAL_CONTROL_CANDIDATE','limitations':manifest['limitations']}
(a.output/'input-pack.json').write_text(json.dumps(new,ensure_ascii=False,indent=2)+'\n');print('Rendered',len(hashes),'frames with reference facial curves')
