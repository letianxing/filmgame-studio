"""Compare captured MLX audio states with LatentSync's own Torch AudioEncoder.

Reuses converted weights; does not claim original-checkpoint or mel parity.
"""
import argparse,json,os,sys
from pathlib import Path


def main():
    p=argparse.ArgumentParser()
    for name in ['upstream','models','capture','output']:p.add_argument('--'+name,required=True)
    p.add_argument('--execute',action='store_true');a=p.parse_args();out=Path(a.output)
    if out.exists():raise ValueError('Output exists')
    if not a.execute:
        from media_resource_guard import bounded_media
        os.environ['OMP_NUM_THREADS']='2'
        with bounded_media([sys.executable,__file__,*sys.argv[1:],'--execute'],out.parent,max_rss_mb=8192,min_free_gb=20,minimum_available_gb=8,max_swap_growth_gb=1,timeout=300) as(proc,stats):proc.wait()
        out.with_suffix('.resources.json').write_text(json.dumps(stats,indent=2)+'\n');return
    import importlib.util,re,types,numpy as np,torch
    from safetensors import safe_open
    torch.set_num_threads(2);torch.set_num_interop_threads(1)
    # Neural class only; decoding/transcription entrypoints must never execute.
    package='_latentsync_audio_reference'
    def unavailable(*args,**kwargs):raise RuntimeError('Decoder outside parity scope')
    parent=types.ModuleType(package);parent.__path__=[];sys.modules[package]=parent
    for name,functions in [('transcribe',['transcribe']),('decoding',['detect_language','decode'])]:
        module=types.ModuleType(package+'.'+name)
        for fn in functions:setattr(module,fn,unavailable)
        sys.modules[module.__name__]=module
    spec=importlib.util.spec_from_file_location(package+'.model',Path(a.upstream)/'latentsync/whisper/whisper/model.py')
    module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
    model=module.AudioEncoder(80,1500,384,6,4).eval();weights={}
    replacements={'self_attn_layer_norm':'attn_ln','final_layer_norm':'mlp_ln','self_attn.q_proj':'attn.query','self_attn.k_proj':'attn.key','self_attn.v_proj':'attn.value','self_attn.out_proj':'attn.out','fc1':'mlp.0','fc2':'mlp.2'}
    with safe_open(str(Path(a.models)/'whisper_encoder.safetensors'),framework='pt',device='cpu') as f:
        for key in f.keys():
            v=f.get_tensor(key);target=key
            if key=='embed_positions.weight':target='positional_embedding'
            elif key.startswith('layer_norm.'):target=key.replace('layer_norm.','ln_post.',1)
            elif key.startswith('layers.'):
                target=re.sub(r'^layers\.(\d+)\.',r'blocks.\1.',key)
                for old,new in replacements.items():target=target.replace('.'+old+'.','.'+new+'.')
            if key.endswith('.weight') and v.ndim==3:v=v.permute(0,2,1)
            weights[target]=v.contiguous().float()
    model.load_state_dict(weights,strict=True)
    data=np.load(a.capture)
    with torch.inference_mode():_,raw=model(torch.from_numpy(data['mel']),include_embeddings=True)
    reference=raw.transpose(0,2,1,3);delta=np.abs(reference-data['states'])
    if not np.isfinite(reference).all():raise ValueError('Nonfinite reference')
    report={'status':'AUDIO_ENCODER_COMPARISON_COMPLETE','shape':list(reference.shape),'meanAbsoluteError':float(delta.mean()),'maxAbsoluteError':float(delta.max()),'relativeMaxError':float(delta.max()/(np.abs(reference).max()+1e-8)),'lastHiddenMeanAbsoluteError':float(delta[:,:,4].mean()),'limitations':['Identical mel input and converted weights; original weights and mel extraction not independently checked.','Feature equality does not establish lip-sync quality.']}
    out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)


if __name__=='__main__':main()
