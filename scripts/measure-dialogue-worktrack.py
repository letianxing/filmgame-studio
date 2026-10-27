"""Serial bounded loudness measurement; does not normalize or approve performances."""
import argparse,json,subprocess,statistics
from pathlib import Path
from media_resource_guard import bounded_media
p=argparse.ArgumentParser();p.add_argument('timeline');p.add_argument('output');a=p.parse_args()
timeline=Path(a.timeline);d=json.loads(timeline.read_text());out=Path(a.output)
if out.exists():raise ValueError('Preserve existing evidence')
def measure(file):
 cmd=['ffmpeg','-hide_banner','-nostdin','-threads','2','-filter_threads','1','-i',str(file),'-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-']
 with bounded_media(cmd,out.parent,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE) as(proc,stats):
  _,err=proc.communicate()
 text=err.decode();start=text.rfind('{');end=text.rfind('}')
 if start<0 or end<start:raise ValueError('Missing loudness evidence')
 metrics=json.loads(text[start:end+1])
 return {k:metrics[k] for k in ['input_i','input_tp','input_lra','input_thresh']}
rows=[]
for i,row in enumerate(d['lines'],1):
 rows.append({'lineId':row['lineId'],'characterId':row['characterId'],'source':row['source'],'metrics':measure(row['source'])})
 if i%15==0:print(f'Measured {i}/{len(d["lines"])}',flush=True)
roles={}
for row in rows:
 value=float(row['metrics']['input_i'])
 if value!=float('-inf'):roles.setdefault(row['characterId'],[]).append(value)
summary={k:{'medianLUFS':statistics.median(v),'minimumLUFS':min(v),'maximumLUFS':max(v),'lines':len(v)} for k,v in roles.items()}
report={'status':'MEASUREMENT_ONLY_NOT_FINAL_MIX','timeline':a.timeline,'fullTrack':measure(timeline.parent/'dialogue.wav'),'characters':summary,'lines':rows,'limitations':'Very short phrases have limited integrated loudness reliability; do not flatten intentional acting dynamics automatically.'}
out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'fullTrack':report['fullTrack'],'characters':summary}))
