"""Check proposed greeting geometry before producing expensive imagery."""
import argparse,hashlib,json,math
from pathlib import Path
import numpy as np


def project(point,camera,target,focal,sensor,aspect):
    convert=np.array([1,-1,1]);p=np.array(point)*convert;c=np.array(camera)*convert;t=np.array(target)*convert
    forward=t-c;forward/=np.linalg.norm(forward)
    right=np.cross(forward,[0,0,1]);right/=np.linalg.norm(right);up=np.cross(right,forward)
    delta=p-c;depth=float(delta@forward)
    if depth<=0:raise ValueError('Point behind camera')
    half=sensor/(2*focal)
    return [.5+float(delta@right)/(2*depth*half),.5+float(delta@up)/(2*depth*half/aspect)]


def main():
    p=argparse.ArgumentParser();p.add_argument('contract');p.add_argument('--output',required=True);a=p.parse_args()
    d=json.loads(Path(a.contract).read_text());out=Path(a.output)
    if out.exists():raise ValueError('Output exists')
    for key in ['sourceScreenplay','layoutSource']:
        expected=d['sourceScreenplaySha256'] if key=='sourceScreenplay' else d['layoutSha256']
        if hashlib.sha256(Path(d[key]).read_bytes()).hexdigest()!=expected:raise ValueError('Source version changed')
    script=json.loads(Path(d['sourceScreenplay']).read_text())['content']
    if d['sourceScene'] not in [s['id'] for s in script['scenes']]:raise ValueError('Unknown screenplay scene')
    layout=json.loads(Path(d['layoutSource']).read_text());cam=d['camera'];actors={v['id']:v for v in d['actors']};rows=[]
    for frame in range(d['frames']):
        t=frame/(d['frames']-1);camera=np.array(cam['positionStart'])*(1-t)+np.array(cam['positionEnd'])*t
        screens={}
        for name,actor in actors.items():
            x,y,z=actor['root'];height=actor['height']
            degrees=0
            if 'bowKeys' in actor:
                keys=actor['bowKeys']
                for left,right in zip(keys,keys[1:]):
                    if left['frame']<=frame<=right['frame']:
                        u=(frame-left['frame'])/(right['frame']-left['frame']);u=u*u*(3-2*u)
                        degrees=left['degrees']*(1-u)+right['degrees']*u;break
            angle=math.radians(degrees);hip=height*.52;lever=height-hip
            head=[x+actor['facing'][0]*math.sin(angle)*lever,y+actor['facing'][1]*math.sin(angle)*lever,hip+math.cos(angle)*lever]
            points={'head':head,'footWest':[x-.14,y,0],'footEast':[x+.14,y,0]}
            projected={k:project(v,camera,cam['target'],cam['focalLengthMm'],cam['sensorWidthMm'],cam['aspect'][0]/cam['aspect'][1]) for k,v in points.items()}
            if any(not .03<v<.97 for point in projected.values() for v in point):raise ValueError(f'Full body clipped: {name} frame {frame}')
            for table in layout['tables']:
                cx,cy=table['center'];w,h=table['size'];distance=math.hypot(max(abs(x-cx)-w/2,0),max(abs(y-cy)-h/2,0))
                if distance<actor['bodyRadius']:raise ValueError('Body root intersects table clearance')
            screens[name]={'points':projected,'torsoDegrees':degrees}
        if not screens['zhang-zhao']['points']['head'][0]<screens['kongming']['points']['head'][0]:raise ValueError('Screen order reversed')
        if camera[0]>=actors['kongming']['root'][0]:raise ValueError('Camera crosses interaction axis')
        rows.append({'frame':frame,'camera':camera.tolist(),'actors':screens})
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(json.dumps({'status':'GEOMETRY_CHECK_PASSED_NOT_MEDIA_APPROVAL','contract':a.contract,'samples':rows,'limitations':['Point projection and static planar body/table clearance only.','No scene occlusion, fan/hand mesh, garment collision, shadow or animation quality certification.']},indent=2)+'\n')


if __name__=='__main__':main()
