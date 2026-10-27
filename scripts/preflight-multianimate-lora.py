"""Check one real rank-128 pair through installed Comfy's LoRA adapter."""
import argparse,hashlib,json,sys
from pathlib import Path


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--comfy-home',required=True);p.add_argument('--weights',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();assert not a.output.exists();sys.path.insert(0,a.comfy_home);sys.argv=['lora-preflight','--cpu']
    import comfy.options
    comfy.options.enable_args_parsing()
    import torch
    from comfy.weight_adapter.lora import LoRAAdapter
    torch.set_num_threads(2);receipt=json.loads((a.weights/'receipt.json').read_text());weights={}
    for row in receipt['tensors']:
        raw=(a.weights/row['file']).read_bytes();assert hashlib.sha256(raw).hexdigest()==row['sha256']
        assert row['dtype']=='F32';weights[row['name'].removeprefix('pipe.dit.')]=torch.frombuffer(bytearray(raw),dtype=torch.float32).reshape(row['shape'])
    key='blocks.0.cross_attn.k';down=weights[key+'.lora_A.default.weight'];up=weights[key+'.lora_B.default.weight']
    assert down.shape==(128,5120) and up.shape==(5120,128)
    # Upstream applies external multiplier 1.0 directly to B@A, so Comfy's
    # optional alpha must be absent (not 1, which would divide by rank).
    loaded=set();adapter=LoRAAdapter.load(key,weights,alpha=None,dora_scale=None,loaded_keys=loaded)
    assert loaded==set(weights) and adapter is not None
    results=[]
    with torch.inference_mode():
        expected=up@down
        expected_peak=float(expected.abs().max())
        assert expected_peak>1e-8,'Zero update cannot validate LoRA scaling'
        for device in ['cpu','mps']:
            base=torch.zeros((5120,5120),device=device,dtype=torch.float32)
            result=adapter.calculate_weight(base,key+'.weight',1.,1.,None,lambda x:x).cpu()
            delta=result-expected;relative=float(delta.square().mean().sqrt()/expected.square().mean().sqrt().clamp_min(1e-8))
            results.append({'device':device,'relativeRmsError':relative,'maxAbsoluteError':float(delta.abs().max()),'passed':bool(torch.isfinite(result).all()) and relative<1e-4})
            del base,result,delta
            if device=='mps':torch.mps.empty_cache()
    report={'status':'PASS_REAL_PAIR_ONLY' if all(x['passed'] for x in results) else 'FAIL','sourceRevision':receipt['revision'],'rank':128,'expectedUpdatePeak':expected_peak,'alphaPolicy':'None gives unit multiplier matching upstream alpha=1.0','results':results,'productionApproved':False,'limitations':['One actual pair, unquantized zero base; not complete GGUF/LoRA or diffusion validation.']}
    a.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
    if report['status']=='FAIL':raise SystemExit(1)


if __name__=='__main__':main()
