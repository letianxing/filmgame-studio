"""Bounded real-weight CPU/MPS check of upstream control encoders only."""
import argparse,ast,copy,hashlib,json,types
from pathlib import Path
import torch
from torch import nn
from torch.nn import functional as F


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source',type=Path,required=True);p.add_argument('--weights',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();assert not a.output.exists();torch.set_num_threads(2)
    tree=ast.parse(a.source.read_text())
    cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='WanUniAnimateVideoPipeline')
    fetch=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='fetch_models')
    names=['label_embedding','dwpose_embedding','randomref_embedding_pose']
    selected=[n for n in fetch.body if isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Attribute) and n.targets[0].attr in names]
    assert len(selected)==3
    label=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='generate_label_map')
    holder=types.SimpleNamespace(p_channnel=4)
    scope={'nn':nn,'torch':torch,'F':F,'self':holder,'concat_dim':4,'randomref_dim':20}
    # Execute only reviewed constructor assignments and the pure mask helper,
    # never the upstream pipeline imports or model manager.
    exec(compile(ast.Module(body=selected+[label],type_ignores=[]),str(a.source),'exec'),scope)
    receipt=json.loads((a.weights/'receipt.json').read_text());states={name:{} for name in names}
    for row in receipt['tensors']:
        raw=(a.weights/row['file']).read_bytes();assert hashlib.sha256(raw).hexdigest()==row['sha256']
        assert row['dtype']=='F32';prefix,key=row['name'].split('.',1)
        states[prefix][key]=torch.frombuffer(bytearray(raw),dtype=torch.float32).reshape(row['shape']).clone()
    for name in names:getattr(holder,name).load_state_dict(states[name],strict=True)
    masks=[torch.zeros(3,17,64,64) for _ in range(2)]
    masks[0][:,:,:,8:24]=255;masks[1][:,:,:,40:56]=255
    labels=scope['generate_label_map'](masks,num_classes=4)
    assert labels.shape==(1,4,17,64,64) and torch.all(labels.sum(1)==1)
    assert torch.all(labels[:,1,:,:,12]==1) and torch.all(labels[:,2,:,:,44]==1)
    generator=torch.Generator().manual_seed(208)
    pose=torch.rand((1,3,17,64,64),generator=generator)
    def pad(x):return torch.cat([x[:,:,:1].repeat(1,1,3,1,1),x],dim=2)
    inputs={'label_embedding':pad(labels),'dwpose_embedding':pad(pose),'randomref_embedding_pose':pose[:,:,0]}
    expected={'label_embedding':(1,5120,5,4,4),'dwpose_embedding':(1,5120,5,4,4),'randomref_embedding_pose':(1,20,8,8)}
    rows=[]
    assert torch.backends.mps.is_available(),'MPS required for this preflight'
    with torch.inference_mode():
        for name in names:
            model=getattr(holder,name).eval();reference=model(inputs[name]);assert tuple(reference.shape)==expected[name]
            for dtype,tolerance in [(torch.float32,.0001),(torch.float16,.005),(torch.bfloat16,.03)]:
                mps=copy.deepcopy(model).to(device='mps',dtype=dtype)
                result=mps(inputs[name].to(device='mps',dtype=dtype)).float().cpu()
                delta=result-reference;relative=float(delta.square().mean().sqrt()/reference.square().mean().sqrt().clamp_min(1e-8))
                passed=bool(torch.isfinite(result).all()) and relative<=tolerance
                rows.append({'module':name,'dtype':str(dtype),'shape':list(result.shape),'relativeRmsError':relative,'maxAbsoluteError':float(delta.abs().max()),'relativeRmsLimit':tolerance,'passed':passed})
                del mps;torch.mps.empty_cache()
    report={'status':'PASS_BOUNDED_ENCODERS_ONLY' if all(r['passed'] for r in rows) else 'FAIL_ENCODER_PARITY','sourceSha256':hashlib.sha256(a.source.read_bytes()).hexdigest(),'weightRevision':receipt['revision'],'tensorsLoaded':len(receipt['tensors']),'tests':rows,'productionApproved':False,'limitations':['Synthetic 17-frame 64x64 input; not production-size resource proof.','No base model, LoRA, diffusion, scene media or lip sync tested.']}
    a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
    if report['status'].startswith('FAIL'):raise SystemExit(1)


if __name__=='__main__':main()
