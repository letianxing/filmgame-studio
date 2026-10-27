"""Render audited Body18 controls using the external DWPose drawing function."""
import argparse,ast,hashlib,json,math
from pathlib import Path
import cv2,numpy as np
from PIL import Image,ImageDraw

p=argparse.ArgumentParser(description=__doc__);p.add_argument('controls',type=Path);p.add_argument('renderer',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
d=json.loads(a.controls.read_text());source=json.loads((a.renderer/'source.json').read_text());raw=(a.renderer/'util.py').read_bytes();assert hashlib.sha256(raw).hexdigest()==source['sha256']
function=next(n for n in ast.parse(raw).body if isinstance(n,ast.FunctionDef) and n.name=='draw_bodypose');scope={'np':np,'cv2':cv2,'math':math};exec(compile(ast.Module(body=[function],type_ignores=[]),str(a.renderer/'util.py'),'exec'),scope)
expected=['nose','neck','right_shoulder','right_elbow','right_wrist','left_shoulder','left_elbow','left_wrist','right_hip','right_knee','right_ankle','left_hip','left_knee','left_ankle','right_eye','left_eye','right_ear','left_ear'];assert d['body18Order']==expected
w,h=d['size'];a.output.mkdir(parents=True,exist_ok=False);order=list(d['actorLabelIds']);hashes=[];mask_hashes={name:[] for name in order}
for i,row in enumerate(d['samples']):
    assert row['frame']==i and [x['actorId'] for x in row['actors']]==order
    points=np.concatenate([np.array(x['body18'])[:,:2] for x in row['actors']]);points/=np.array([w,h]);assert np.isfinite(points).all() and (points>=0).all() and (points<1).all()
    indices=np.arange(len(points)).reshape(len(order),18);canvas=np.zeros((h,w,3),np.uint8);canvas=scope['draw_bodypose'](canvas,points,indices)
    assert canvas.any();target=a.output/f'{i:03d}.png';Image.fromarray(canvas).save(target);hashes.append(hashlib.sha256(target.read_bytes()).hexdigest())
    occupied=np.zeros((h,w),bool)
    for name in order:
        path=a.controls.parent/name/f'{i:03d}.png'
        with Image.open(path) as im:
            assert im.size==(w,h);pixels=np.array(im.convert('L'));assert set(np.unique(pixels))<={0,255};active=pixels>0
        assert active.any() and not (occupied&active).any();occupied|=active;mask_hashes[name].append(hashlib.sha256(path.read_bytes()).hexdigest())
(a.output/'reference-pose.png').write_bytes((a.output/'000.png').read_bytes())
sheet=Image.new('RGB',(w*3,h+24),'#111111');draw=ImageDraw.Draw(sheet)
for index,frame in enumerate([0,24,48]):
    with Image.open(a.output/f'{frame:03d}.png') as im:sheet.paste(im,(index*w,0))
    draw.text((index*w+5,h+5),f'frame {frame}',fill='white')
sheet.save(a.output/'contact.jpg',quality=94)
report={'status':'BODY_POSE_AND_MASK_FILES_ALIGNED_NOT_PRODUCTION_APPROVAL','frames':len(hashes),'fps':d['fps'],'size':[w,h],'actorOrder':order,'poseSha256':hashes,'maskSha256':mask_hashes,'referencePoseEqualsFirstFrame':True,'drawingSource':source,'landmarkSource':str(a.controls),'productionApproved':False,'limitations':['Body18 proxy landmarks only; face68 and hand21 not supplied.','No pose detector run; these are calibrated projections of authored geometry.','Matched file dimensions and frame IDs do not establish generated identity or motion quality.']}
(a.output/'manifest.json').write_text(json.dumps(report,indent=2)+'\n');print('Pose/mask frames validated:',len(hashes))
