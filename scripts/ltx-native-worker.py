"""Bounded native audio/video evaluation through the pinned LTX MLX CLI."""
import json,os,signal,subprocess,sys
from pathlib import Path
from media_resource_guard import bounded_media

def stop(_signal,_frame):raise SystemExit(130)
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
if len(sys.argv)==3 and sys.argv[1]=='--execute':
    data=json.loads(Path(sys.argv[2]).read_text())
    os.environ.update({'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','HF_HUB_DISABLE_TELEMETRY':'1',
      'LTX2_GEMMA_EVAL_EVERY':'1','LTX2_DIT_EVAL_EVERY':'1','LTX2_VAE_DECODE_BUDGET_GB':'4',
      'OMP_NUM_THREADS':'2','LTX2_COMPUTE_DTYPE':'bfloat16'})
    import mlx.core as mx
    mx.set_memory_limit(16*1024**3);mx.set_cache_limit(512*1024**2)
    sys.argv=['ltx-2-mlx','generate','--model',data['modelDir'],'--gemma',data['gemmaDir'],
      '--prompt',data['prompt'],'--output',data['output'],'--height','320','--width','512',
      '--frames',str(data['frames']),'--frame-rate','24','--seed','208','--distilled','--low-ram']
    if data.get('suppressText'):sys.argv += ['--nag','--nag-video-only','--negative-prompt','subtitles, captions, Chinese writing, text, letters, logos, watermarks, typography over the image']
    if data.get('image'):sys.argv += ['--image',data['image'],'0','1.0','--image',data['image'],'last','1.0']
    from ltx_pipelines_mlx.cli import main
    main()
else:
    config=Path(sys.argv[1]).resolve();data=json.loads(config.read_text())
    if data['frames'] not in (49,73,97):raise ValueError('Only short native-audio validation clips are allowed')
    output=Path(data['output']);output.parent.mkdir(parents=True,exist_ok=True)
    if output.exists():raise ValueError('Refusing overwrite of existing native test')
    stats=None
    try:
      with bounded_media([sys.executable,__file__,'--execute',str(config)],output.parent,max_rss_mb=24576,
          min_free_gb=20,timeout=1800,minimum_available_gb=8,max_swap_growth_gb=1) as (process,stats):process.wait()
    finally:
      if stats is not None:
        Path(str(output)+'.resources.json').write_text(json.dumps(stats,indent=2));print(json.dumps(stats),flush=True)
