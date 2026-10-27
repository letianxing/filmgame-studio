"""Verify the assembled adapter against audited headers and independent probes."""
import argparse,hashlib,json,re
from pathlib import Path
import torch
from safetensors import safe_open


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('weights',type=Path);p.add_argument('--audit',type=Path,required=True)
    p.add_argument('--probe',type=Path,action='append',default=[]);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();assert not a.output.exists();torch.set_num_threads(2)
    audit=json.loads(a.audit.read_text());receipt=json.loads(a.weights.with_suffix('.download.json').read_text())
    assert receipt['status']=='RANGES_ASSEMBLED_REQUIRES_MODEL_VALIDATION'
    assert receipt['sourceRevision']==audit['revision'] and a.weights.stat().st_size==receipt['expectedBytes']
    with a.weights.open('rb') as f:assert hashlib.file_digest(f,'sha256').hexdigest()==receipt['sha256']
    expected={row['name']:row for shard in audit['shards'] for row in shard['selected']}
    independent={}
    for folder in a.probe:
        probe=json.loads((folder/'receipt.json').read_text());assert probe['revision']==audit['revision']
        for row in probe['tensors']:independent[row['name']]=row['sha256']
    checked=0;pairs={};payload=0
    with safe_open(a.weights,framework='pt',device='cpu') as f:
        assert set(f.keys())==set(expected) and f.metadata()['source_revision']==audit['revision']
        for name,row in expected.items():
            tensor=f.get_tensor(name)
            assert list(tensor.shape)==row['shape'] and tensor.dtype==torch.float32
            assert torch.isfinite(tensor).all(),name
            payload+=tensor.numel()*tensor.element_size()
            if name in independent:
                assert hashlib.sha256(tensor.numpy().tobytes()).hexdigest()==independent[name],name
                checked+=1
            if 'lora' in name:
                match=re.fullmatch(r'pipe\.dit\.(.+)\.lora_([AB])\.default\.weight',name)
                assert match,name;pairs.setdefault(match[1],{})[match[2]]=list(tensor.shape)
        assert payload==audit['selectedBytes'] and checked==len(independent)
        for name,pair in pairs.items():
            assert set(pair)=={'A','B'} and pair['A'][0]==pair['B'][1]==128,name
    report={'status':'ADAPTER_FILE_VERIFIED_NOT_MODEL_APPROVAL','tensors':len(expected),'loraPairs':len(pairs),'payloadBytes':payload,'allValuesFinite':True,'independentRangeProbeTensorsMatched':checked,'sha256':receipt['sha256'],'sourceRevision':audit['revision'],'productionApproved':False,'limitations':['Assembly checksum is locally calculated, not a published checksum for the selective bundle.','Unquantized parameter contents validated; GGUF integration and generated-media quality remain untested.']}
    a.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))


if __name__=='__main__':main()
