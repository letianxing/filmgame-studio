"""Guarded metadata/strict-shape check of the downloaded GGUF Control model."""
import argparse,json,os,sys
from pathlib import Path


def main():
    p=argparse.ArgumentParser()
    for name in ['comfy-home','gguf-home','dependencies','model-root','receipt','output']:p.add_argument('--'+name,required=True)
    p.add_argument('--mps-probe',action='store_true')
    p.add_argument('--compare-cpu',action='store_true')
    p.add_argument('--audit-conditions')
    p.add_argument('--execute',action='store_true');a=p.parse_args();out=Path(a.output)
    if out.exists():raise ValueError('Output exists')
    receipt=json.loads(Path(a.receipt).read_text());weight=Path(receipt['path']).resolve()
    if receipt['status']!='SHA256_VERIFIED' or weight.stat().st_size!=receipt['bytes']:raise ValueError('Verified weight required')
    if not a.execute:
        from media_resource_guard import bounded_media
        os.environ.update(OMP_NUM_THREADS='2',HF_HUB_OFFLINE='1',PYTORCH_ENABLE_MPS_FALLBACK='0',PYTORCH_MPS_HIGH_WATERMARK_RATIO='0.4',PYTORCH_MPS_LOW_WATERMARK_RATIO='0.3')
        stats=None
        try:
            with bounded_media([sys.executable,__file__,*sys.argv[1:],'--execute'],out.parent,max_rss_mb=24576,min_free_gb=20,minimum_available_gb=8,max_swap_growth_gb=1,timeout=900) as(proc,stats):proc.wait()
        finally:
            if stats is not None:out.with_suffix('.resources.json').write_text(json.dumps(stats,indent=2)+'\n')
        return
    import importlib.util
    sys.path[:0]=[str(Path(a.dependencies).resolve()),str(Path(a.comfy_home).resolve())]
    sys.argv=['wan-control-load-probe','--fp16-unet','--use-pytorch-cross-attention']+([] if a.mps_probe else ['--cpu'])
    import comfy.options
    comfy.options.enable_args_parsing()
    import torch,folder_paths
    torch.set_num_threads(2)
    for name in ['unet','diffusion_models']:folder_paths.add_model_folder_path(name,str(weight.parent),is_default=True)
    root=Path(a.gguf_home).resolve();spec=importlib.util.spec_from_file_location('filmgame_gguf',root/'__init__.py',submodule_search_locations=[str(root)])
    module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
    patcher=module.NODE_CLASS_MAPPINGS['UnetLoaderGGUF']().load_unet(weight.name,dequant_dtype='float16',patch_dtype='float16')[0]
    cfg=patcher.model.model_config.unet_config
    projection=patcher.model.diffusion_model.patch_embedding.weight
    shape=list(getattr(projection,'tensor_shape',projection.shape))
    if cfg.get('in_dim')!=148 or cfg.get('out_dim')!=48:raise ValueError('Not expected 48-channel Wan2.2 Fun Control model')
    config_report={k:v for k,v in cfg.items() if isinstance(v,(str,int,float,bool,list,tuple,type(None)))}
    report={'status':'FULL_CONTROL_MODEL_LOADED_CPU_SHAPE_VERIFIED','weightSha256':receipt['sha256'],'modelClass':type(patcher.model).__name__,'unetConfig':config_report,'patchEmbeddingShape':shape,'limitations':['CPU loading and tensor contracts only.','No MPS sampling or control-following quality test completed.']}
    if a.audit_conditions:
        conditions=torch.load(a.audit_conditions,map_location='cpu',weights_only=True)
        latent=conditions['latent'];audit=[];fmt=patcher.model.latent_format
        for label in ['positive','negative']:
            cross,metadata=conditions[label][0];packed=metadata['concat_latent_image'].clone()
            expected=torch.cat([fmt.process_in(packed[:,:48]),1-metadata['concat_mask'],fmt.process_in(packed[:,48:])],dim=1)
            actual=patcher.model.extra_conds(**metadata,noise=torch.zeros_like(latent['samples']),device=torch.device('mps'),cross_attn=cross,denoise_mask=latent.get('noise_mask'))
            delta=(actual['c_concat'].cond.cpu()-expected).abs()
            reference=fmt.process_in(metadata['reference_latents'][0])[:,:,0]
            ref_error=(actual['reference_latent'].cond.cpu()-reference).abs().max().item()
            audit.append({'label':label,'packedShape':list(expected.shape),'concatMaxError':delta.max().item(),'referenceMaxError':ref_error,'rawConditionMutated':not torch.equal(packed,metadata['concat_latent_image']),'controlNormalizedStd':expected[:,:48].std().item(),'maskedVideoNormalizedStd':expected[:,52:].std().item(),'textStd':cross.float().std().item()})
        report['conditionAudit']=audit
    if a.mps_probe:
        import time,comfy.model_management as mm
        mm.load_models_gpu([patcher],force_full_load=True)
        torch.manual_seed(31)
        noise=torch.randn(1,48,5,16,16,device='mps')
        concat=torch.randn(1,100,5,16,16,device='mps')
        text=torch.randn(1,6,4096,device='mps')
        reference=torch.randn(1,48,16,16,device='mps')
        denoise_mask=None
        if a.audit_conditions:
            latent=conditions['latent'];cross,metadata=conditions['positive'][0]
            noise=torch.randn(latent['samples'].shape,device='mps')
            noise[:,:,:1]=fmt.process_in(latent['samples'][:,:,:1]).to('mps')
            denoise_mask=latent.get('noise_mask').to('mps')
            prepared=patcher.model.extra_conds(**metadata,noise=noise,device=torch.device('mps'),cross_attn=cross,denoise_mask=denoise_mask)
            concat=prepared['c_concat'].cond;text=prepared['c_crossattn'].cond.to('mps');reference=prepared['reference_latent'].cond
        started=time.monotonic()
        with torch.inference_mode():
            result=patcher.model.apply_model(noise,torch.tensor([.5],device='mps'),c_concat=concat,c_crossattn=text,reference_latent=reference,denoise_mask=denoise_mask)
        torch.mps.synchronize()
        if not torch.isfinite(result).all():raise ValueError('Nonfinite MPS model output')
        report.update(status='FULL_CONTROL_MPS_SINGLE_CALL_COMPLETE',outputShape=list(result.shape),seconds=time.monotonic()-started,outputStd=result.float().std().item(),mpsDriverBytes=torch.mps.driver_allocated_memory(),limitations=['Random small latent conditions only; no full sampling or control-following quality validation.'])
        if a.compare_cpu:
            expected=result.detach().float().cpu()
            noise,concat,text,reference=[v.cpu() for v in [noise,concat,text,reference]]
            if denoise_mask is not None:denoise_mask=denoise_mask.cpu()
            del result
            mm.unload_all_models();patcher.model.to('cpu');torch.mps.empty_cache()
            started=time.monotonic()
            with torch.inference_mode():
                actual=patcher.model.apply_model(noise,torch.tensor([.5]),c_concat=concat,c_crossattn=text,reference_latent=reference,denoise_mask=denoise_mask).float()
            if not torch.isfinite(actual).all():raise ValueError('Nonfinite CPU reference output')
            delta=(actual-expected).abs()
            report['backendComparison']={'cpuSeconds':time.monotonic()-started,'meanAbsoluteError':delta.mean().item(),'maxAbsoluteError':delta.max().item(),'relativeMaxError':(delta.max()/actual.abs().max().clamp_min(1e-8)).item(),'cosine':torch.nn.functional.cosine_similarity(actual.flatten(),expected.flatten(),dim=0).item(),'scope':'Same GGUF weights and small random conditions; not full-video numerical or quality parity.'}
            if a.audit_conditions:
                report['backendComparison']['scope']='Same GGUF weights, real full-length positive conditions and one shared synthetic latent state at sigma .5; not a full diffusion trajectory comparison.'
                report['limitations']=['One full-length forward comparison only; not generated-media quality acceptance.']
    out.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)


if __name__=='__main__':main()
