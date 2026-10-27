"""Thin configured CLI boundary around pinned mlx-video; upstream source is unchanged."""
import gc, json, math, os, runpy, signal, subprocess, sys, weakref
from pathlib import Path
from media_resource_guard import bounded_media
from wan_profiles import validate_wan_profile

def stop(_signum, _frame):
    raise SystemExit(130)
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)

if len(sys.argv) == 3 and sys.argv[1] == '--execute':
    request = json.loads(Path(sys.argv[2]).read_text())
    profile = validate_wan_profile(request,json.loads((Path(request['modelDir'])/'config.json').read_text()))
    os.environ['HF_HOME'] = request['hfHome']
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    os.environ['OMP_NUM_THREADS'] = '2'
    import mlx.core as mx
    mx.set_memory_limit(profile['mlxLimitGiB'] * 1024**3)
    mx.set_cache_limit(512 * 1024**2)
    # The pinned CLI unconditionally expands UMT5 to FP32 (>21GiB). Use its public
    # model class through a first-party loader; BF16 compute avoids FP16 overflow.
    # Attention's own FP32 softmax remains upstream code; no upstream file is edited.
    from mlx_video.models.wan_2 import utils as wan_utils
    from mlx_video.models.wan_2.text_encoder import T5Encoder
    def bounded_t5_loader(model_path, config):
        fields = ['vocab_size','dim','dim_attn','dim_ffn','num_heads','num_layers','num_buckets']
        encoder = T5Encoder(**{name:getattr(config,'t5_'+name) for name in fields}, shared_pos=False)
        weights = mx.load(str(model_path))
        if len(weights) != 242:raise ValueError('Unexpected encoder tensor count')
        # Convert one tensor at a time, never hold a second full encoder copy.
        for key in tuple(weights):
            original = weights.pop(key)
            weights[key] = original.astype(mx.bfloat16)
            mx.eval(weights[key])
            del original
            mx.clear_cache()
        encoder.load_weights(list(weights.items()), strict=True)
        mx.eval(encoder.parameters())
        return encoder
    original_encode = wan_utils.encode_text
    def checked_encode(*args, **kwargs):
        result = original_encode(*args, **kwargs)
        if not bool(mx.all(mx.isfinite(result)).item()):raise ValueError('Nonfinite text conditioning')
        return result.astype(mx.float32)
    wan_utils.load_t5_encoder = bounded_t5_loader
    wan_utils.encode_text = checked_encode
    if profile['fps']==16:
        # Cross-converter compatibility must fail closed. Upstream's default
        # strict=False could silently leave uninitialized parameters in a new pack.
        from mlx_video.models.wan_2.wan_2 import WanModel
        from mlx_video.models.wan_2.convert import _quantize_predicate
        import mlx.nn as nn
        loaded_model_refs = []
        def strict_wan_loader(model_path,config,quantization=None,loras=None):
            if loras:raise ValueError('LoRA is not part of the bounded 14B comparison')
            model=WanModel(config)
            nn.quantize(model,group_size=quantization['group_size'],bits=quantization['bits'],
                class_predicate=lambda path,m:_quantize_predicate(path,m))
            weights=mx.load(str(model_path))
            # SceneWorks omits the deterministic RoPE table. Preserve the table
            # calculated by this model class; every learned parameter stays strict.
            if 'freqs' not in weights:weights['freqs']=model.freqs
            model.load_weights(list(weights.items()),strict=True)
            mx.eval(model.parameters())
            if request.get('lightningDir'):
                from wan_runtime_lora import attach_runtime_lora
                count=attach_runtime_lora(model,Path(request['lightningDir'])/Path(model_path).name)
                print(f'Runtime Lightning LoRA: {count} modules, quantized base retained',flush=True)
            loaded_model_refs.append(weakref.ref(model))
            # The pinned denoising loop retains `_call` after deleting `model`.
            # Supply an eager weak callable in its supported callable-cache slot;
            # --no-compile prevents the CLI from replacing it with a strong closure.
            from weak_model_call import weak_model_call
            model._compiled = weak_model_call(model)
            return model
        wan_utils.load_wan_model=strict_wan_loader
        original_vae_loader = wan_utils.load_vae_decoder
        def checked_vae_loader(*args, **kwargs):
            gc.collect()
            mx.clear_cache()
            alive = sum(ref() is not None for ref in loaded_model_refs)
            print(json.dumps({'stage':'before_vae_decode','liveTransformers':alive,
                'mlxActiveBytes':mx.get_active_memory()}),flush=True)
            if alive:
                raise RuntimeError('Transformer references remain at VAE boundary; refusing overlapping model load')
            from wan_causal_decode import CausalWanDecoder
            return CausalWanDecoder(original_vae_loader(*args, **kwargs),request['output']+'.latents.safetensors')
        wan_utils.load_vae_decoder = checked_vae_loader
    sys.argv = ['mlx_video.models.wan_2.generate', '--model-dir', request['modelDir'], '--image', request['image'],
        '--prompt', request['prompt'], '--width', str(request['width']), '--height', str(request['height']),
        '--num-frames', str(request['frames']), '--steps', str(request['steps']), '--seed', str(request['seed']),
        '--scheduler', 'euler', '--tiling', 'aggressive', '--output-path', request['output']]
    if request.get('negativePrompt'):sys.argv += ['--negative-prompt', request['negativePrompt']]
    if request.get('lightningDir'):sys.argv += ['--guide-scale','1']
    # The pinned CLI keeps models_to_compile and its loop variable alive until
    # return, despite deleting the named transformers before VAE decode. Use its
    # supported eager path so the existing cleanup can actually release them.
    if profile['fps']==16:sys.argv += ['--no-compile']
    runpy.run_module('mlx_video.models.wan_2.generate', run_name='__main__')
    Path(request['output']+'.mlx-memory.json').write_text(json.dumps({'mlxPeakBytes':mx.get_peak_memory(),
        'caveat':'MLX allocator peak, not complete machine unified-memory usage'}))
else:
    request_path = Path(sys.argv[1]).resolve()
    request = json.loads(request_path.read_text())
    validate_wan_profile(request,json.loads((Path(request['modelDir'])/'config.json').read_text()))
    if Path(request['output']).exists():raise ValueError('Refusing to overwrite existing video')
    stats = None
    try:
        with bounded_media([sys.executable, __file__, '--execute', str(request_path)],Path(request['output']).parent,
            max_rss_mb=24576,min_free_gb=20,timeout=1800,minimum_available_gb=8,max_swap_growth_gb=1) as (process,stats):
            process.wait()
    finally:
        if stats is not None:
            Path(request['output']+'.resources.json').write_text(json.dumps(stats,indent=2))
            print(json.dumps(stats),flush=True)
