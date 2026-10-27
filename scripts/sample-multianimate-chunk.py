"""Run a bounded Euler segment; resume Comfy's flow-scaled latent checkpoint."""
import argparse,hashlib,importlib.util,json,os,sys,time
from pathlib import Path


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('request',type=Path);p.add_argument('--start',type=int,required=True);p.add_argument('--end',type=int,required=True);p.add_argument('--execute',action='store_true');a=p.parse_args()
    raw=a.request.read_bytes();d=json.loads(raw);digest=hashlib.sha256(raw).hexdigest();root=a.request.parent
    if not 0<=a.start<a.end<=d['steps'] or a.end-a.start>5:raise ValueError('At most five scheduled steps per guarded segment')
    out=root/f'sample-{a.end:03d}.pt'
    if out.exists() or out.with_suffix('.partial.pt').exists():raise ValueError('Checkpoint output exists; no retry')
    if not a.execute:
        from media_resource_guard import bounded_media
        os.environ.update(HF_HUB_OFFLINE='1',OMP_NUM_THREADS='2',PYTORCH_ENABLE_MPS_FALLBACK='0',PYTORCH_MPS_HIGH_WATERMARK_RATIO='0.4',PYTORCH_MPS_LOW_WATERMARK_RATIO='0.3')
        stats=None
        try:
            with bounded_media([sys.executable,__file__,str(a.request),'--start',str(a.start),'--end',str(a.end),'--execute'],root,max_rss_mb=24576,min_free_gb=20,minimum_available_gb=8,max_swap_growth_gb=1,timeout=1800) as(proc,stats):proc.wait()
        finally:
            if stats is not None:out.with_suffix('.resources.json').write_text(json.dumps(stats,indent=2)+'\n')
        return
    sys.path[:0]=[str(Path(d['dependencies']).resolve()),str(Path(d['comfyHome']).resolve())]
    sys.argv=['multianimate-sample','--fp16-unet','--cpu-vae','--use-pytorch-cross-attention']
    import comfy.options
    comfy.options.enable_args_parsing()
    import torch,folder_paths
    import comfy.model_management as mm
    mm.vram_state=mm.VRAMState.NO_VRAM;mm.lowvram_available=True;torch.set_num_threads(2)
    spec=importlib.util.spec_from_file_location('condition_serialization',Path(__file__).with_name('animate2-staged-worker.py'));helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    condition_root=Path(d.get('conditioningDirectory',str(root)))
    source_raw=(condition_root/'request.json').read_bytes();source_request=json.loads(source_raw)
    allowed={'steps','cfg','acceleration','conditioningDirectory'}
    if any(source_request.get(k)!=d.get(k) for k in (set(source_request)|set(d))-allowed):raise ValueError('Cannot reuse conditions after non-sampling request changes')
    visual=torch.load(condition_root/'visual.pt',map_location='cpu',weights_only=True);controls=torch.load(d['actorControls'],map_location='cpu',weights_only=True)
    assert visual['stage']=='visual' and visual['requestSha256']==hashlib.sha256(source_raw).hexdigest()
    assert visual['inputPackSha256']==controls['inputPackSha256']==d['inputPackSha256']
    latent=visual['latent']
    if a.start:
        previous=torch.load(root/f'sample-{a.start:03d}.pt',map_location='cpu',weights_only=True)
        if previous.get('requestSha256')!=digest or previous.get('nextStep')!=a.start or previous.get('stage')!='sample':raise ValueError('Invalid continuation checkpoint')
        latent=previous['latent']
    assert list(latent['samples'].shape)==[1,16,13,36,64]
    for category in ['unet','diffusion_models']:folder_paths.add_model_folder_path(category,str(Path(d['modelRoot']).resolve()/'diffusion_models'),is_default=True)
    home=Path(d['ggufHome']).resolve();spec=importlib.util.spec_from_file_location('multianimate_gguf',home/'__init__.py',submodule_search_locations=[str(home)]);module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
    model=module.NODE_CLASS_MAPPINGS['UnetLoaderGGUF']().load_unet(d['model'],dequant_dtype='float16',patch_dtype='float16')[0]
    from multianimate_adapter import attach_weights,attach_condition
    from multianimate_conditioning import reference_pose_correction,sampling_sigmas
    from comfy_extras.nodes_model_advanced import ModelSamplingSD3
    from comfy_extras.nodes_custom_sampler import SamplerCustom,KSamplerSelect
    model,_=attach_weights(model,d['adapter'],d['verification'])
    acceleration=None
    if d.get('acceleration'):
        from multianimate_adapter import attach_acceleration
        model,acceleration=attach_acceleration(model,d['acceleration']['path'],d['acceleration']['sha256'])
    model=attach_condition(model,controls['condition']);model=ModelSamplingSD3().patch(model,shift=d['shift'])[0]
    positive=helper.restore_conditions(visual['positive']);negative=helper.restore_conditions(visual['negative'])
    sigmas=sampling_sigmas(d['steps'],d['shift'])[a.start:a.end+1];sampler=KSamplerSelect.execute(sampler_name='euler')[0]
    started=time.monotonic()
    with torch.inference_mode(),reference_pose_correction(model.model,controls['referencePoseCorrection']):
        result=SamplerCustom.execute(model=model,add_noise=a.start==0,noise_seed=d['seed'],cfg=d['cfg'],positive=positive,negative=negative,sampler=sampler,sigmas=sigmas,latent_image=latent)
    checkpoint=helper.plain_tensors(result[0]);checkpoint['samples']=checkpoint['samples'].float()
    payload={'stage':'sample','requestSha256':digest,'inputPackSha256':d['inputPackSha256'],'nextStep':a.end,'totalSteps':d['steps'],'latent':checkpoint,'checkpointConvention':'Comfy flow inverse_noise_scaling plus raw VAE latent format; only first segment adds noise.'}
    partial=out.with_suffix('.partial.pt');torch.save(payload,partial);partial.replace(out)
    report={'status':'ALL_STEPS_COMPLETE_REVIEW_REQUIRED' if a.end==d['steps'] else 'CHECKPOINT_SAVED_CONTINUATION_REQUIRED','startStep':a.start,'nextStep':a.end,'totalSteps':d['steps'],'newNoiseAdded':a.start==0,'samplingSeconds':time.monotonic()-started,'requestSha256':digest,'productionApproved':False}
    report['acceleration']=acceleration
    out.with_suffix('.receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)


if __name__=='__main__':main()
