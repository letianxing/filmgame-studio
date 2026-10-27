"""Insert verified silent action takes between dialogue cues without repeating frames."""
import argparse,json,subprocess
from fractions import Fraction
from pathlib import Path
from media_resource_guard import bounded_media
p=argparse.ArgumentParser();p.add_argument('request');a=p.parse_args();d=json.loads(Path(a.request).read_text());base=Path(d['base']);out=Path(d['output']);out.parent.mkdir(parents=True,exist_ok=True)
if out.exists() or not 1<=len(d['inserts'])<=4:raise ValueError('New bounded preview output required')
def probe(file):
 x=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(file)],text=True));return next(s for s in x['streams'] if s['codec_type']=='video')
v=probe(base);fps=Fraction(v['r_frame_rate']);base_frames=int(v['nb_frames']);inserts=sorted(d['inserts'],key=lambda x:x['atFrame']);cues=json.loads(Path(d['cues']).read_text());plates=json.loads(Path(d['nameplates']).read_text());previous=-1
for item in inserts:
 if any(type(item[k])is not int for k in ['atFrame','inFrame','outFrame']) or not 0<=item['inFrame']<item['outFrame']:raise ValueError('Invalid insert interval')
 if not previous<item['atFrame']<base_frames:raise ValueError('Insertion points must be unique and inside base')
 previous=item['atFrame'];t=float(item['atFrame']/fps)
 if any(x['start']<t<x['end'] for x in cues):raise ValueError('Action insertion would split a subtitle/utterance cue')
 q=probe(item['file'])
 if (q['width'],q['height'],Fraction(q['r_frame_rate']))!=(v['width'],v['height'],fps) or item['outFrame']>int(q['nb_frames']):raise ValueError('Insert source format or range mismatch')
cmd=['ffmpeg','-v','error','-n','-filter_complex_threads','1','-filter_threads','1','-threads','2','-i',str(base)]
for item in inserts:cmd+=['-threads','2','-i',item['file']]
cmd+=['-f','lavfi','-i','anullsrc=r=48000:cl=mono']
n=len(inserts);filters=['[0:v]split='+str(n+1)+''.join(f'[bv{i}]'for i in range(n+1)),'[0:a]asplit='+str(n+1)+''.join(f'[ba{i}]'for i in range(n+1))]
if n>1:filters.append(f'[{n+1}:a]asplit={n}'+''.join(f'[sil{i}]'for i in range(n)))
ends=[0]+[x['atFrame']for x in inserts]+[base_frames];pairs=[];segments=[];position=0
for i in range(n+1):
 start,end=ends[i:i+2];duration=float((end-start)/fps);filters += [f'[bv{i}]trim=start_frame={start}:end_frame={end},setpts=PTS-STARTPTS[vb{i}]',f'[ba{i}]atrim=start={float(start/fps)}:end={float(end/fps)},asetpts=PTS-STARTPTS[ab{i}]'];pairs += [f'[vb{i}]',f'[ab{i}]'];segments.append({'file':str(base),'sourceFrames':[start,end],'timelineFrames':[position,position+end-start]});position+=end-start
 if i<n:
  x=inserts[i];length=x['outFrame']-x['inFrame'];filters += [f'[{i+1}:v]trim=start_frame={x["inFrame"]}:end_frame={x["outFrame"]},setpts=PTS-STARTPTS[vi{i}]',f'[{"sil"+str(i) if n>1 else str(n+1)+":a"}]atrim=duration={float(length/fps)},asetpts=PTS-STARTPTS[ai{i}]'];pairs += [f'[vi{i}]',f'[ai{i}]'];segments.append({'file':x['file'],'sourceFrames':[x['inFrame'],x['outFrame']],'timelineFrames':[position,position+length],'audio':'silent placeholder; foley/room tone pending'});position+=length
filters.append(''.join(pairs)+f'concat=n={2*n+1}:v=1:a=1[v][a]');partial=out.with_suffix('.partial.mp4');duration=float(position/fps)
cmd+=['-filter_complex',';'.join(filters),'-map','[v]','-map','[a]','-t',str(duration),'-c:v','libx264','-threads','2','-crf','16','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-b:a','192k','-movflags','+faststart',str(partial)]
with bounded_media(cmd,out.parent) as(proc,stats):proc.wait()
if int(probe(partial)['nb_frames'])!=position:raise ValueError('Output frame count mismatch')
partial.replace(out)
def shifted(entries):
 result=[]
 for x in entries:
  delay=sum(float((v['outFrame']-v['inFrame'])/fps) for v in inserts if float(v['atFrame']/fps)<=x['start'])
  result.append({**x,'start':x['start']+delay,'end':x['end']+delay})
 return result
(out.parent/'cues.json').write_text(json.dumps(shifted(cues),ensure_ascii=False,indent=2));(out.parent/'nameplates.json').write_text(json.dumps(shifted(plates),ensure_ascii=False,indent=2));(out.parent/'assembly-manifest.json').write_text(json.dumps({**d,'segments':segments,'frames':position,'seconds':duration,'resources':stats,'status':'PARTIAL_OPENING_PREVIEW'},ensure_ascii=False,indent=2));print(json.dumps({'frames':position,'seconds':duration}))
