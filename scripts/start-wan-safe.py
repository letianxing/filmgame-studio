"""Launch configured ComfyUI for one local Wan session under workstation limits.
Run with COMFYUI_PYTHON after loading .env.local. Does not load a model until requested.
"""
import json, os, subprocess
from pathlib import Path
from media_resource_guard import bounded_media
home=Path(os.environ['COMFYUI_HOME']);base=Path(os.environ['COMFYUI_BASE_DIRECTORY'])
base.mkdir(parents=True,exist_ok=True)
os.environ['PYTORCH_MPS_HIGH_WATERMARK_RATIO']='0.45'
os.environ['PYTORCH_MPS_LOW_WATERMARK_RATIO']='0.35'
fallback=os.environ.get('WAN_MPS_FALLBACK','1')
if fallback not in ('0','1'):raise ValueError('WAN_MPS_FALLBACK must be 0 or 1')
os.environ['PYTORCH_ENABLE_MPS_FALLBACK']=fallback
session_timeout=int(os.environ.get('WAN_SESSION_TIMEOUT_SECONDS','3600'))
if not 1<=session_timeout<=3600:raise ValueError('Session timeout must be within 1–3600 seconds')
os.environ['OMP_NUM_THREADS']='2';os.environ['MKL_NUM_THREADS']='2'
command=[os.environ['COMFYUI_PYTHON'],str(home/'main.py'),'--listen','127.0.0.1','--port','8188',
 '--base-directory',str(base),'--database-url',f'sqlite:///{base}/user/comfyui.db',
 '--disable-auto-launch','--disable-all-custom-nodes','--disable-api-nodes','--lowvram','--cache-none',
 '--fp16-text-enc','--fp16-unet','--use-split-cross-attention']
if os.environ.get('WAN_CPU_VAE') == 'true': command += ['--cpu-vae','--fp32-vae']
if os.environ.get('WAN_MPS_LAYER_OFFLOAD') == 'true':
 command[1]=str(Path(__file__).with_name('comfy-mps-layer-offload.py').resolve())
print('Safe Wan server: one job; RSS24GiB, available RAM8GiB, swap growth1GiB, MPS cap0.45, disk20GiB.',flush=True)
stats = None
try:
 with bounded_media(command,base,max_rss_mb=24576,min_free_gb=20,timeout=session_timeout,minimum_available_gb=8,max_swap_growth_gb=1) as (process,stats):
  process.wait()
except subprocess.CalledProcessError as error:
 if error.returncode not in (-15, -2): raise
 print('Local Wan worker stopped by operator.',flush=True)
finally:
 if stats is not None:
  report=Path(os.environ.get('WAN_RESOURCE_REPORT',str(base/'user'/'wan-resource-stats.json')))
  report.parent.mkdir(parents=True,exist_ok=True)
  report.write_text(json.dumps(stats,indent=2))
  print(json.dumps(stats),flush=True)
