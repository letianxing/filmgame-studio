"""Reuse text/image tensors only when all their actual inputs are unchanged."""
import argparse,hashlib,json
from pathlib import Path
import torch


def signature(request,pack):
    return {**{k:request[k] for k in ['positive','negative','textEncoder','clipVision','vae','modelRoot','comfyHome']},
            **{k:pack[k] for k in ['referenceSha256','size','frames']}}


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('source_request',type=Path);p.add_argument('target_request',type=Path);p.add_argument('--image-only',action='store_true');a=p.parse_args()
    source=json.loads(a.source_request.read_text());source_root=Path(source.get('conditioningDirectory',str(a.source_request.parent)))
    source_raw=(source_root/'request.json').read_bytes();source=json.loads(source_raw)
    target_raw=a.target_request.read_bytes();target=json.loads(target_raw)
    old_pack=json.loads(Path(source['inputPack']).read_text());new_pack_raw=Path(target['inputPack']).read_bytes();new_pack=json.loads(new_pack_raw)
    old_signature=signature(source,old_pack);new_signature=signature(target,new_pack)
    if a.image_only:
        for key in ['positive','negative','textEncoder']:old_signature.pop(key);new_signature.pop(key)
    if old_signature!=new_signature:raise ValueError('Text/image inputs differ; recomputation required')
    assert hashlib.sha256(new_pack_raw).hexdigest()==target['inputPackSha256']
    assert hashlib.sha256(Path(new_pack['reference']).read_bytes()).hexdigest()==new_pack['referenceSha256']
    source_hash=hashlib.sha256(source_raw).hexdigest();target_hash=hashlib.sha256(target_raw).hexdigest()
    new_text=None
    if a.image_only:
        new_text=torch.load(a.target_request.parent/'text.pt',map_location='cpu',weights_only=True)
        assert new_text['stage']=='text' and new_text['requestSha256']==target_hash
    for stage in (['visual'] if a.image_only else ['text','visual']):
        path=a.target_request.parent/(stage+'.pt');assert not path.exists() and not path.with_suffix('.partial.pt').exists()
        data=torch.load(source_root/(stage+'.pt'),map_location='cpu',weights_only=True)
        assert data['stage']==stage and data['requestSha256']==source_hash
        if a.image_only:
            for branch in ['positive','negative']:
                assert len(data[branch])==1 and len(new_text[branch])==1
                image_metadata={key:data[branch][0][1][key] for key in ['concat_latent_image','concat_mask','clip_vision_output']}
                embedding,metadata=new_text[branch][0]
                data[branch]=[[embedding,{**metadata,**image_metadata}]]
        data.update(requestSha256=target_hash,reusedFromRequestSha256=source_hash)
        if stage=='visual':data['inputPackSha256']=target['inputPackSha256']
        partial=path.with_suffix('.partial.pt');torch.save(data,partial);partial.replace(path)
    report={'status':'IMAGE_CONDITIONS_REUSED_WITH_NEW_TEXT' if a.image_only else 'TEXT_IMAGE_CONDITIONS_REUSED_AFTER_SIGNATURE_CHECK','source':str(source_root),'sourceRequestSha256':source_hash,'targetRequestSha256':target_hash,'signature':new_signature,'actorControlsReused':False,'productionApproved':False}
    (a.target_request.parent/'conditioning-reuse.json').write_text(json.dumps(report,indent=2)+'\n');print(report['status'])


if __name__=='__main__':main()
