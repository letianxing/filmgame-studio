"""Serial text or image conditioning stage through configured local Comfy APIs."""
import argparse,hashlib,importlib.util,json,os,sys
from pathlib import Path


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('request',type=Path);p.add_argument('--stage',choices=['text','visual'],required=True);p.add_argument('--execute',action='store_true');a=p.parse_args()
    raw=a.request.read_bytes();d=json.loads(raw);out=a.request.parent/(a.stage+'.pt');assert not out.exists() and not out.with_suffix('.partial.pt').exists()
    if not a.execute:
        from media_resource_guard import bounded_media
        os.environ.update(HF_HUB_OFFLINE='1',OMP_NUM_THREADS='2',PYTORCH_ENABLE_MPS_FALLBACK='0')
        stats=None
        try:
            with bounded_media([sys.executable,__file__,str(a.request),'--stage',a.stage,'--execute'],out.parent,max_rss_mb=24576,min_free_gb=20,minimum_available_gb=8,max_swap_growth_gb=1,timeout=900) as(proc,stats):proc.wait()
        finally:
            if stats is not None:out.with_suffix('.resources.json').write_text(json.dumps(stats,indent=2)+'\n')
        return
    sys.path.insert(0,d['comfyHome']);sys.argv=['conditioning','--cpu','--fp16-text-enc','--cpu-vae','--fp32-vae']
    import comfy.options
    comfy.options.enable_args_parsing()
    import torch,nodes,folder_paths
    torch.set_num_threads(2)
    for category in ['text_encoders','clip_vision','vae']:folder_paths.add_model_folder_path(category,str(Path(d['modelRoot'])/category),is_default=True)
    digest=hashlib.sha256(raw).hexdigest();payload={'stage':a.stage,'requestSha256':digest}
    spec=importlib.util.spec_from_file_location('serialization',Path(__file__).with_name('animate2-staged-worker.py'));helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    with torch.inference_mode():
        if a.stage=='text':
            clip=nodes.CLIPLoader().load_clip(d['textEncoder'],type='wan',device='cpu')[0]
            for name in ['positive','negative']:payload[name]=nodes.CLIPTextEncode().encode(clip,d[name])[0]
        else:
            import numpy as np
            from PIL import Image
            from comfy_extras.nodes_wan import WanImageToVideo
            prior=torch.load(a.request.parent/'text.pt',map_location='cpu',weights_only=True);assert prior['requestSha256']==digest and prior['stage']=='text'
            pack_raw=Path(d['inputPack']).read_bytes();assert hashlib.sha256(pack_raw).hexdigest()==d['inputPackSha256'];pack=json.loads(pack_raw)
            ref=Path(pack['reference']);assert hashlib.sha256(ref.read_bytes()).hexdigest()==pack['referenceSha256']
            with Image.open(ref) as image:
                resized=image.convert('RGB').resize(tuple(pack['size']));resized.save(a.request.parent/'reference-encoded.png');pixels=torch.from_numpy(np.array(resized).astype(np.float32)/255)[None]
            vision=nodes.CLIPVisionLoader().load_clip(d['clipVision'])[0]
            clip_output=nodes.CLIPVisionEncode().encode(vision,pixels,crop='none')[0]
            assert list(clip_output.penultimate_hidden_states.shape)==[1,257,1280]
            # Release image model before loading the VAE; retain only its output.
            import comfy.model_management as mm,gc
            del vision;mm.unload_all_models();gc.collect()
            vae=nodes.VAELoader().load_vae(d['vae'])[0];assert vae.latent_channels==16
            result=WanImageToVideo.execute(positive=prior['positive'],negative=prior['negative'],vae=vae,width=pack['size'][0],height=pack['size'][1],length=pack['frames'],batch_size=1,start_image=pixels,clip_vision_output=clip_output)
            payload.update(positive=result[0],negative=result[1],latent=result[2],inputPackSha256=d['inputPackSha256'])
            assert list(payload['latent']['samples'].shape)==[1,16,13,36,64]
    payload=helper.plain_tensors(payload);partial=out.with_suffix('.partial.pt');torch.save(payload,partial);partial.replace(out)
    report={'status':'CONDITIONING_STAGE_COMPLETE_NOT_MEDIA_APPROVAL','stage':a.stage,'requestSha256':digest,'productionApproved':False}
    out.with_suffix('.receipt.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)


if __name__=='__main__':main()
