"""Encode the real, hash-bound actor controls as a separate guarded stage."""
import argparse,ast,hashlib,json,os,sys,types
from pathlib import Path


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('config',type=Path);p.add_argument('--execute',action='store_true');a=p.parse_args()
    cfg=json.loads(a.config.read_text());out=Path(cfg['output']);out.parent.mkdir(parents=True,exist_ok=True)
    if out.exists() or out.with_suffix('.partial.pt').exists():raise ValueError('Output already exists')
    if not a.execute:
        from media_resource_guard import bounded_media
        os.environ.update(OMP_NUM_THREADS='2',PYTORCH_ENABLE_MPS_FALLBACK='0',PYTORCH_MPS_HIGH_WATERMARK_RATIO='0.4',PYTORCH_MPS_LOW_WATERMARK_RATIO='0.3')
        stats=None
        try:
            with bounded_media([sys.executable,__file__,str(a.config),'--execute'],out.parent,max_rss_mb=8192,min_free_gb=20,minimum_available_gb=8,max_swap_growth_gb=1,timeout=600) as(proc,stats):proc.wait()
        finally:
            if stats is not None:out.with_suffix('.resources.json').write_text(json.dumps(stats,indent=2)+'\n')
        return
    import numpy as np,torch
    from torch import nn
    from PIL import Image
    torch.set_num_threads(2)
    pack_path=Path(cfg['inputPack']);raw=pack_path.read_bytes();pack=json.loads(raw);manifest=json.loads(Path(pack['integrityManifest']).read_text())
    assert pack['frames']==49 and pack['size']==[512,288] and pack['actorOrder']==manifest['actorOrder']
    assert hashlib.sha256(Path(pack['reference']).read_bytes()).hexdigest()==pack['referenceSha256']
    poses=[];labels=[];w,h=pack['size']
    for frame in range(pack['frames']):
        path=Path(pack['poseDirectory'])/f'{frame:03d}.png';assert hashlib.sha256(path.read_bytes()).hexdigest()==manifest['poseSha256'][frame]
        with Image.open(path) as im:assert im.size==(w,h);poses.append(np.array(im.convert('RGB')))
        label=np.zeros((h,w),np.int64)
        for i,name in enumerate(pack['actorOrder'],1):
            path=Path(pack['maskDirectories'][name])/f'{frame:03d}.png';assert hashlib.sha256(path.read_bytes()).hexdigest()==manifest['maskSha256'][name][frame]
            with Image.open(path) as im:assert im.size==(w,h);mask=np.array(im.convert('L'))
            assert set(np.unique(mask))<={0,255};active=mask>0;assert active.any() and not (label[active]>0).any();label[active]=i
        labels.append(label)
    source=Path(cfg['source']);source_raw=source.read_bytes();assert hashlib.sha256(source_raw).hexdigest()==cfg['sourceSha256']
    tree=ast.parse(source_raw);cls=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='WanUniAnimateVideoPipeline');fetch=next(n for n in cls.body if isinstance(n,ast.FunctionDef) and n.name=='fetch_models')
    names=['label_embedding','dwpose_embedding','randomref_embedding_pose'];selected=[n for n in fetch.body if isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Attribute) and n.targets[0].attr in names];assert len(selected)==3
    holder=types.SimpleNamespace(p_channnel=4);scope={'nn':nn,'self':holder,'concat_dim':4,'randomref_dim':20}
    exec(compile(ast.Module(body=selected,type_ignores=[]),str(source),'exec'),scope)
    weights=Path(cfg['weights']);receipt=json.loads((weights/'receipt.json').read_text());states={k:{} for k in names}
    for row in receipt['tensors']:
        b=(weights/row['file']).read_bytes();assert hashlib.sha256(b).hexdigest()==row['sha256'];prefix,key=row['name'].split('.',1)
        states[prefix][key]=torch.frombuffer(bytearray(b),dtype=torch.float32).reshape(row['shape']).clone()
    for name in names:getattr(holder,name).load_state_dict(states[name],strict=True);getattr(holder,name).eval().to(device='mps',dtype=torch.float16)
    def pad(x):return torch.cat([x[:,:,:1].repeat(1,1,3,1,1),x],dim=2)
    with torch.inference_mode():
        indices=torch.from_numpy(np.stack(labels)).to('mps');del labels
        onehot=torch.nn.functional.one_hot(indices,num_classes=4).permute(3,0,1,2).unsqueeze(0).to(torch.float16);del indices
        encoded_labels=holder.label_embedding(pad(onehot));del onehot
        pixels=torch.from_numpy(np.stack(poses)).permute(3,0,1,2).unsqueeze(0).to('mps',torch.float16)/255.;del poses
        encoded_pose=holder.dwpose_embedding(pad(pixels))
        reference_pose=holder.randomref_embedding_pose(pixels[:,:,0]).unsqueeze(2).cpu()
        condition=(encoded_labels+encoded_pose).flatten(2).transpose(1,2).contiguous().cpu()
        assert condition.shape==(1,7488,5120) and reference_pose.shape==(1,20,1,36,64)
        assert torch.isfinite(condition).all() and torch.isfinite(reference_pose).all()
    payload={'stage':'actor-controls','inputPackSha256':hashlib.sha256(raw).hexdigest(),'actorOrder':pack['actorOrder'],'condition':condition,'referencePoseCorrection':reference_pose,'sourceSha256':cfg['sourceSha256'],'weightRevision':receipt['revision'],'dtype':'float16'}
    partial=out.with_suffix('.partial.pt');torch.save(payload,partial);partial.replace(out)
    report={'status':'REAL_CONTROLS_ENCODED_NOT_MEDIA_APPROVAL','actorOrder':pack['actorOrder'],'frames':49,'size':[w,h],'conditionShape':list(condition.shape),'referenceCorrectionShape':list(reference_pose.shape),'conditionAbsMax':float(condition.abs().max()),'allFinite':True,'inputPackSha256':payload['inputPackSha256'],'productionApproved':False}
    out.with_suffix('.receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)


if __name__=='__main__':main()
