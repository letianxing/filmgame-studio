"""Experimental process-local Comfy entrypoint; leaves upstream files untouched."""
import os,runpy,sys,json
from pathlib import Path
home=Path(os.environ['COMFYUI_HOME']).resolve()
if not (home/'main.py').is_file():raise ValueError('Configured ComfyUI entrypoint missing')
sys.path.insert(0,str(home))
import comfy.options
comfy.options.enable_args_parsing()
import comfy.model_management as mm
if mm.get_torch_device().type!='mps':raise ValueError('This evaluation adapter is MPS-only')
before=mm.vram_state.name
mm.vram_state=mm.VRAMState.NO_VRAM
mm.lowvram_available=True
evidence={'mode':'EXPERIMENTAL_MPS_LAYER_OFFLOAD','previousState':before,'effectiveState':mm.vram_state.name,'initialModelDevice':str(mm.unet_inital_load_device(14000000000,mm.torch.float16)),'offloadDevice':str(mm.unet_offload_device()),'upstreamFilesModified':False}
print(json.dumps(evidence),flush=True)
if os.environ.get('WAN_OFFLOAD_PREFLIGHT_ONLY')=='1':
    target=Path(os.environ['WAN_OFFLOAD_PREFLIGHT_REPORT'])
    target.write_text(json.dumps(evidence,indent=2)+'\n')
else:
    sys.argv[0]=str(home/'main.py')
    runpy.run_path(str(home/'main.py'),run_name='__main__')
