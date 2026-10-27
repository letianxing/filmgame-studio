"""Constrained shared-camera/height calibration; no independent image warps."""
import argparse,importlib.util,json,math
from pathlib import Path
import numpy as np
from scipy.optimize import least_squares


def main():
    p=argparse.ArgumentParser();p.add_argument('contract');p.add_argument('--body-anchors',required=True);p.add_argument('--face-anchors',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    d=json.loads(Path(a.contract).read_text());body=json.loads(Path(a.body_anchors).read_text());face=json.loads(Path(a.face_anchors).read_text());out=Path(a.output)
    if out.exists():raise ValueError('Output exists')
    spec=importlib.util.spec_from_file_location('projection',Path(__file__).with_name('check-greeting-spatial-contract.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    size=np.array([1672,941.]);observations=[]
    for j,actor in enumerate(d['actors']):
        name=actor['id'];observations.append((j,'nose',face[name]['landmarks']['1'],1.0))
        for key,index,weight in [('shoulderLeft',11,.7),('shoulderRight',12,.7),('hipLeft',23,.25),('hipRight',24,.25)]:
            entry=body[name]['points'][str(index)]
            if entry['visibility']>=.8:observations.append((j,key,entry['pixel'],weight))
        observations.append((j,'groundCenter',{'zhang-zhao':[496,790],'kongming':[1235,861]}[name],1.0))
    def world_point(actor,key,height):
        x,y,z=actor['root'];direction=actor['facing'][1]
        if key=='nose':return [x,y+direction*.115,height-.15]
        if key=='groundCenter':return [x,y,0]
        side=-1 if key.endswith('Left') else 1
        side*=-direction
        radius=.22 if key.startswith('shoulder') else .12
        elevation=height*(.82 if key.startswith('shoulder') else .52)
        yaw=math.radians(-direction*actor.get('torsoOpenTowardCameraDegrees',0))
        # Rotate in right-handed Blender world, then return layout coordinates.
        return [x+math.cos(yaw)*side*radius,y-math.sin(yaw)*side*radius,elevation]
    def project(params):
        predictions=[]
        for j,key,target,weight in observations:
            point=world_point(d['actors'][j],key,params[6+j])
            u,v=module.project(point,params[:3],[4.7,params[3],params[4]],params[5],36,16/9)
            predictions.append(np.array([u,1-v])*size)
        return np.array(predictions)
    targets=np.array([v[2] for v in observations]);weights=np.array([v[3] for v in observations])[:,None]
    heights=np.array([v['height'] for v in d['actors']])
    layout=json.loads(Path(d['layoutSource']).read_text())
    def occlusion_penalties(params):
        penalties=[];camera=np.array(params[:3])
        for actor in d['actors']:
            # Intersect camera-to-ground rays with each table's upper plane.
            for dx in [-.18,0,.18]:
                foot=np.array(actor['root'],dtype=float);foot[0]+=dx
                at_table=camera+(foot-camera)*((camera[2]-.38)/camera[2])
                for table in layout['tables']:
                    delta=np.abs(at_table[:2]-np.array(table['center']))
                    inset=np.array(table['size'])/2+.04-delta
                    penalties.append(max(0,float(min(inset)))*3000)
        return penalties
    def residual(params):
        image=((project(params)-targets)*weights).ravel()
        return np.concatenate([image,(params[6:]-heights)*120,occlusion_penalties(params)])
    low=[.3,8,.9,7,.65,26,*list(heights-.08)];high=[2,10.5,1.65,8.3,1.2,48,*list(heights+.08)]
    fits=[least_squares(residual,[x,y,1.25,7.75,.9,35,*heights],bounds=(low,high),loss='soft_l1',f_scale=15,max_nfev=1500) for x,y in [(.5,8.5),(.8,9.2),(1.5,10)]]
    fit=min(fits,key=lambda f:np.linalg.norm(f.fun));predictions=project(fit.x);rows=[]
    for observation,pred in zip(observations,predictions):
        j,key,target,weight=observation;rows.append({'actor':d['actors'][j]['id'],'anchor':key,'targetPixels':target,'predictedPixels':pred.tolist(),'errorPixels':float(np.linalg.norm(pred-target)),'weight':weight})
    result={'status':'SHARED_CAMERA_AND_HEIGHT_FIT_REQUIRES_VISUAL_REVIEW','sourceContract':a.contract,'cameraPosition':fit.x[:3].tolist(),'cameraTarget':[4.7,float(fit.x[3]),float(fit.x[4])],'focalLengthMm':float(fit.x[5]),'actorHeights':{v['id']:float(fit.x[6+j]) for j,v in enumerate(d['actors'])},'actorRootsUnchanged':True,'anchors':rows,'tableOcclusionPenaltyMax':max(occlusion_penalties(fit.x)),'maxAnchorErrorPixels':max(v['errorPixels'] for v in rows),'rmsAnchorErrorPixels':float(np.sqrt(np.mean([v['errorPixels']**2 for v in rows]))),'limitations':['Garment-covered hips are uncertain despite high detector visibility.','Sole centers are manual approximations.','This fit is not independent validation of the generated camera or scene geometry.','Table-plane ray test does not certify other people or wall occlusions.']}
    out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items() if k!='anchors'},indent=2))


if __name__=='__main__':main()
