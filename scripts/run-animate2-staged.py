"""Run one new guarded Animate2 experiment as serial, terminating process stages."""
import argparse,json,os,subprocess
from pathlib import Path
from media_resource_guard import bounded_media
p=argparse.ArgumentParser();p.add_argument('--graph',required=True);p.add_argument('--output-dir',required=True);p.add_argument('--comfy-home',required=True);p.add_argument('--comfy-python',required=True);p.add_argument('--base-directory',required=True)
# The 49-frame Mac experiment passed with SDPA; split attention exhausted MPS.
p.add_argument('--attention',choices=['pytorch','split'],default='pytorch');a=p.parse_args()
out=Path(a.output_dir).resolve();out.mkdir(parents=True,exist_ok=False)
base=Path(a.base_directory).resolve();graph=Path(a.graph).resolve()
os.environ.update(PYTORCH_ENABLE_MPS_FALLBACK='0',PYTORCH_MPS_HIGH_WATERMARK_RATIO='0.45',PYTORCH_MPS_LOW_WATERMARK_RATIO='0.35',OMP_NUM_THREADS='2')
report={'status':'RUNNING','graph':str(graph),'attention':a.attention,'stages':[]};report_path=out/'run.json'
for stage in ['text','visual','sample','decode']:
    output=out/('decoded.pt' if stage=='decode' else stage+'.pt')
    cmd=[a.comfy_python,str(Path(__file__).with_name('animate2-staged-worker.py').resolve()),'--stage',stage,'--comfy-home',a.comfy_home,'--model-root',str(base/'models'),'--graph',str(graph),'--output',str(output)]
    cmd+=['--attention',a.attention]
    if stage=='visual':cmd+=['--text-input',str(out/'text.pt'),'--input-root',str(base/'input')]
    if stage=='sample':cmd+=['--visual-input',str(out/'visual.pt')]
    if stage=='decode':cmd+=['--sample-input',str(out/'sample.pt')]
    item={'stage':stage,'status':'RUNNING'};report['stages'].append(item);report_path.write_text(json.dumps(report,indent=2)+'\n');print('Starting '+stage,flush=True)
    stats=None
    try:
        with (out/(stage+'.log')).open('w') as log:
            with bounded_media(cmd,out,max_rss_mb=24576,minimum_available_gb=8,max_swap_growth_gb=1,min_free_gb=20,timeout=1800 if stage=='sample' else 900,stdout=log,stderr=log) as(proc,stats):proc.wait()
        if not output.is_file():raise RuntimeError('Stage exited without output')
        item['status']='COMPLETE'
    except Exception as error:
        item.update(status='FAILED',error=type(error).__name__+': '+str(error));report['status']='STOPPED_NO_AUTOMATIC_RETRY';raise
    finally:
        item['resources']=stats;report_path.write_text(json.dumps(report,indent=2)+'\n')
        if stats is not None:(out/(stage+'-resources.json')).write_text(json.dumps(stats,indent=2)+'\n')
    print('Completed '+stage,flush=True)
report['status']='ALL_STAGES_COMPLETE_VISUAL_REVIEW_REQUIRED';report_path.write_text(json.dumps(report,indent=2)+'\n')
