"""Load the real quantized base and check one patched MPS linear operation."""
import argparse,importlib.util,json,os,sys,time
from pathlib import Path


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('config',type=Path);p.add_argument('--execute',action='store_true');a=p.parse_args()
    d=json.loads(a.config.read_text());out=Path(d['output']);out.parent.mkdir(parents=True,exist_ok=True)
    if out.exists():raise ValueError('Preserve existing evidence')
    if not a.execute:
        from media_resource_guard import bounded_media
        os.environ.update(HF_HUB_OFFLINE='1',OMP_NUM_THREADS='2',PYTORCH_ENABLE_MPS_FALLBACK='0',PYTORCH_MPS_HIGH_WATERMARK_RATIO='0.4',PYTORCH_MPS_LOW_WATERMARK_RATIO='0.3')
        stats=None
        try:
            with bounded_media([sys.executable,__file__,str(a.config),'--execute'],out.parent,max_rss_mb=24576,min_free_gb=20,minimum_available_gb=8,max_swap_growth_gb=1,timeout=300) as(proc,stats):proc.wait()
        finally:
            if stats is not None:out.with_suffix('.resources.json').write_text(json.dumps(stats,indent=2)+'\n')
        return
    sys.path[:0]=[str(Path(d['dependencies']).resolve()),str(Path(d['comfyHome']).resolve())]
    sys.argv=['gguf-preflight','--fp16-unet','--cpu-vae','--use-pytorch-cross-attention']
    import comfy.options
    comfy.options.enable_args_parsing()
    import torch,folder_paths
    torch.set_num_threads(2)
    if d.get('fullForward'):
        import comfy.model_management as mm
        mm.vram_state=mm.VRAMState.NO_VRAM;mm.lowvram_available=True
    for key in ['unet','diffusion_models']:folder_paths.add_model_folder_path(key,str(Path(d['modelRoot']).resolve()/'diffusion_models'),is_default=True)
    home=Path(d['ggufHome']).resolve();spec=importlib.util.spec_from_file_location('multianimate_gguf',home/'__init__.py',submodule_search_locations=[str(home)])
    module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
    model=module.NODE_CLASS_MAPPINGS['UnetLoaderGGUF']().load_unet(d['model'],dequant_dtype='float16',patch_dtype='float16')[0]
    from multianimate_adapter import attach_weights
    patched,controls=attach_weights(model,d['adapter'],d['verification'])
    acceleration=None
    if d.get('acceleration'):
        from multianimate_adapter import attach_acceleration
        patched,acceleration=attach_acceleration(patched,d['acceleration']['path'],d['acceleration']['sha256'])
    if d.get('fullForward'):
        from multianimate_adapter import attach_condition
        with torch.inference_mode():
            torch.manual_seed(208)
            condition=torch.randn(1,80,5120,dtype=torch.float16)*.001
            conditioned=attach_condition(patched,condition)
            options={**conditioned.model_options['transformer_options'],'cond_or_uncond':[0]}
            calls=[];original=options['patches_replace']['dit'][('double_block',0)]
            def counted(arguments,callbacks):
                calls.append(list(arguments['img'].shape));return original(arguments,callbacks)
            options={**options,'patches_replace':{'dit':{('double_block',0):counted}}}
            started=time.monotonic();mm.load_models_gpu([conditioned],memory_required=1024**3)
            x=torch.randn(1,36,5,8,8,dtype=torch.float16,device='mps')
            text=torch.randn(1,8,4096,dtype=torch.float16,device='mps')
            clip=torch.randn(1,257,1280,dtype=torch.float16,device='mps')
            result=conditioned.model.diffusion_model(x,torch.tensor([500.],device='mps'),text,clip_fea=clip,transformer_options=options)
            torch.mps.synchronize();elapsed=time.monotonic()-started
            passed=list(result.shape)==[1,16,5,8,8] and bool(torch.isfinite(result).all()) and calls==[[1,80,5120]]
            report={'status':'PASS_SMALL_FULL_FORWARD_ONLY' if passed else 'FAIL','registeredLoraPairs':len(conditioned.patches),'conditionInjectionCalls':calls,'outputShape':list(result.shape),'outputAbsMax':float(result.abs().max()),'loadAndForwardSeconds':elapsed,'offloadMode':mm.vram_state.name,'productionApproved':False,'limitations':['Synthetic 17-frame-equivalent 64x64 input, short text context; no production-size resource guarantee.','No VAE/image encoder, sampler sequence, scene identity or lip-sync validation.']}
        report['acceleration']=acceleration
        report['registeredPatchTargets']=report.pop('registeredLoraPairs')
        out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
        if not passed:raise SystemExit(1)
        return
    key='diffusion_model.blocks.0.cross_attn.k.weight';layer=patched.model.diffusion_model.blocks[0].cross_attn.k
    with torch.inference_mode():
        torch.manual_seed(208);x=torch.randn(1,4,5120,dtype=torch.float16).to('mps')
        base_weight,bias=layer.cast_bias_weight(x);baseline=torch.nn.functional.linear(x,base_weight,bias)
        patch=patched.patches[key][0][1];up,down=patch.weights[:2]
        assert patch.weights[2] is None
        update=up.to('mps',torch.float16)@down.to('mps',torch.float16)
        expected=torch.nn.functional.linear(x,base_weight+update,bias)
        patched.patch_weight_to_device(key,device_to=torch.device('mps'))
        actual=layer(x);difference=actual.float()-expected.float()
        relative=float(difference.square().mean().sqrt()/expected.float().square().mean().sqrt().clamp_min(1e-8))
        changed=float((actual.float()-baseline.float()).abs().max())
        passed=bool(torch.isfinite(actual).all()) and relative<.005 and changed>1e-4
    report={'status':'PASS_REAL_GGUF_LORA_LINEAR_ONLY' if passed else 'FAIL','registeredLoraPairs':len(patched.patches),'controlTensors':len(controls),'relativeRmsError':relative,'maxAbsoluteError':float(difference.abs().max()),'maxChangeFromUnpatched':changed,'outputShape':list(actual.shape),'productionApproved':False,'limitations':['One linear layer only; no complete diffusion forward, sampler, image encoding or generated-media validation.']}
    out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)
    if not passed:raise SystemExit(1)


if __name__=='__main__':main()
