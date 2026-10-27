"""Build a screenplay-ordered candidate dialogue track, never a final sound mix."""
import argparse, hashlib, json, math
from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

p=argparse.ArgumentParser()
p.add_argument('--script',required=True)
p.add_argument('--coverage',required=True)
p.add_argument('--output-dir',required=True)
a=p.parse_args()
script_path=Path(a.script)
script=json.loads(script_path.read_text())
coverage=json.loads(Path(a.coverage).read_text())
digest=hashlib.sha256(script_path.read_bytes()).hexdigest()
if digest != coverage['scriptSha256']:raise ValueError('Coverage script hash mismatch')
bindings={x['id']:x for x in coverage['lines']}
if len(bindings)!=len(coverage['lines']):raise ValueError('Duplicate line bindings')
rows=[]
for scene in sorted(script['content']['scenes'],key=lambda s:s['order']):
 for ordinal,line in enumerate(scene['dialogue'],1):
  key=f"{scene['id']}-line-{ordinal:02d}"
  b=bindings[key]
  if (b['sceneId'],b['characterId'],b['text'])!=(scene['id'],line['characterId'],line['text']):
   raise ValueError('Authoritative dialogue mismatch: '+key)
  source=Path(b['audio']);info=sf.info(source)
  if not 0<info.duration<=120 or info.channels not in (1,2):raise ValueError('Unbounded or invalid source')
  rows.append({'lineId':key,'sceneId':scene['id'],'characterId':line['characterId'],'text':line['text'],'source':str(source),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'reviewStatus':b['audioReview'],'pronunciationQuestions':b.get('pronunciationQuestions',[]),'sceneHeading':scene['heading']})
if len(rows)!=len(bindings):raise ValueError('Extra dialogue bindings')
out=Path(a.output_dir)
out.mkdir(parents=True,exist_ok=False)
rate=24000;cursor=0;peak=0.;clipped=0
partial=out/'dialogue.partial.wav'
with sf.SoundFile(partial,'w',samplerate=rate,channels=1,subtype='PCM_24') as dest:
 for i,row in enumerate(rows):
  samples,sr=sf.read(row['source'],dtype='float32',always_2d=True)
  samples=samples.mean(axis=1)
  if sr!=rate:
   gcd=math.gcd(sr,rate);samples=resample_poly(samples,rate//gcd,sr//gcd)
  if not np.isfinite(samples).all():raise ValueError('Non-finite audio')
  peak=max(peak,float(np.max(np.abs(samples))));clipped+=int(np.count_nonzero(np.abs(samples)>=1))
  row.update(startSample=cursor,endSample=cursor+len(samples),start=cursor/rate,end=(cursor+len(samples))/rate)
  dest.write(samples);cursor+=len(samples)
  gap=0 if i==len(rows)-1 else (.8 if rows[i+1]['sceneId']!=row['sceneId'] else .3)
  padding=round(gap*rate);dest.write(np.zeros(padding,dtype=np.float32));cursor+=padding
  row['followingProvisionalGapSeconds']=gap
if clipped:raise ValueError('Clipped samples; partial retained for investigation')
info=sf.info(partial)
if info.frames!=cursor:raise ValueError('Written sample count mismatch')
partial.replace(out/'dialogue.wav')
manifest={'status':'CANDIDATE_DIALOGUE_WORKTRACK_NOT_FINAL_MIX','script':a.script,'scriptSha256':digest,'sampleRate':rate,'samples':cursor,'seconds':cursor/rate,'lineCount':len(rows),'peakAmplitude':peak,'clippedSamples':clipped,'timingPolicy':'All source audio preserved. 0.3s inter-line and 0.8s inter-scene gaps are provisional; action, foley, scene pacing and music not yet timed.','subtitlePolicy':'Canonical whole-line text with source clip boundaries, not final subtitle segmentation or word alignment.','lines':rows}
(out/'timeline.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
def stamp(t):
 ms=round(t*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
 return f'{h:02}:{m:02}:{s:02},{ms:03}'
(out/'canonical-dialogue-draft.srt').write_text('\n\n'.join(f"{i}\n{stamp(row['start'])} --> {stamp(row['end'])}\n{row['text']}" for i,row in enumerate(rows,1))+'\n',encoding='utf-8')
print(json.dumps({k:manifest[k] for k in ['lineCount','seconds','peakAmplitude','clippedSamples','status']}))
