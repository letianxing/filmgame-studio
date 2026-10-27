"""Bounded frame-accurate preview with one continuous canonical dialogue track."""
import argparse,hashlib,json,subprocess
from pathlib import Path
from media_resource_guard import bounded_media
p=argparse.ArgumentParser();p.add_argument('request');p.add_argument('--validate-only',action='store_true');a=p.parse_args();d=json.loads(Path(a.request).read_text());out=Path(d['output']);out.parent.mkdir(parents=True,exist_ok=True)
if (out.exists() and not a.validate_only) or not 1<=len(d['clips'])<=8:raise ValueError('New bounded preview output required')
fps=d['fps'];clips=d['clips'];seen={};filters=[];cmd=['ffmpeg','-v','error','-n','-filter_complex_threads','1','-filter_threads','1'];total=0
for i,c in enumerate(clips):
 file=Path(c['file']);start,end=c['inFrame'],c['outFrame']
 if any(type(x)is not int for x in [start,end]) or not 0<=start<end:raise ValueError('Invalid frame interval')
 info=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(file)],text=True));v=next(s for s in info['streams'] if s['codec_type']=='video');n,den=map(int,v['r_frame_rate'].split('/'))
 if n/den!=fps or (v['width'],v['height'])!=(d['width'],d['height']) or end>int(v['nb_frames']):raise ValueError('Source format/range mismatch')
 prior=seen.setdefault(str(file.resolve()),[])
 if any(start<stop and end>begin for begin,stop in prior):raise ValueError('Repeated source frames are not permitted')
 prior.append((start,end));cmd+=['-threads','2','-i',str(file)];filters.append(f'[{i}:v]trim=start_frame={start}:end_frame={end},setpts=PTS-STARTPTS[v{i}]');total+=end-start
coverage_path=Path(d['coverage']);coverage=json.loads(coverage_path.read_text());line=next(x for x in coverage['lines'] if x['id']==d['lineId'])
script_path=(coverage_path.parent/coverage['script']).resolve();script_bytes=script_path.read_bytes()
if hashlib.sha256(script_bytes).hexdigest()!=coverage['scriptSha256']:raise ValueError('Screenplay hash mismatch')
script=json.loads(script_bytes);scene=next(s for s in script['content']['scenes'] if s['id']==line['sceneId']);canonical=scene['dialogue'][line['ordinal']-1]
if canonical['text']!=line['text'] or canonical['characterId']!=line['characterId']:raise ValueError('Coverage differs from immutable screenplay')
audio=line['audio'];offset=d['audioStartFrame']/fps;duration=total/fps
ainfo=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-of','json',audio],text=True));audio_duration=float(ainfo['format']['duration'])
if offset<0 or offset+audio_duration>duration:raise ValueError('Preview would truncate canonical dialogue')
if 'subtitleSpans' in d:
 cues=[];cursor=0;previous_end=0
 for span in d['subtitleSpans']:
  start,end=span['startChar'],span['endChar'];t0,t1=span['startFrame']/fps,span['endFrame']/fps
  if start!=cursor or not start<end<=len(line['text']) or not previous_end<=t0<t1<=duration:raise ValueError('Invalid canonical subtitle spans')
  cues.append({'start':t0,'end':t1,'text':line['text'][start:end]});cursor=end;previous_end=t1
 if cursor!=len(line['text']):raise ValueError('Subtitle spans omit canonical words')
else:
 first,rest=line['text'].split('，',1);cues=[{'start':offset,'end':d['subtitleCutFrame']/fps,'text':first+'，'},{'start':d['subtitleCutFrame']/fps,'end':offset+audio_duration,'text':rest}]
assert ''.join(x['text'] for x in cues)==line['text']
if a.validate_only:
 print(json.dumps({'valid':True,'frames':total,'seconds':duration,'canonicalText':line['text']},ensure_ascii=False));raise SystemExit
cmd+=['-threads','2','-i',audio];filters.append(''.join(f'[v{i}]'for i in range(len(clips)))+f'concat=n={len(clips)}:v=1:a=0[v]');filters.append(f'[{len(clips)}:a]adelay={round(offset*1000)}:all=1,apad=whole_dur={duration}[a]')
partial=out.with_suffix('.partial.mp4');cmd+=['-filter_complex',';'.join(filters),'-map','[v]','-map','[a]','-t',str(duration),'-c:v','libx264','-threads','2','-crf','16','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-b:a','192k','-movflags','+faststart',str(partial)]
with bounded_media(cmd,out.parent) as(proc,stats):proc.wait()
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(partial)],text=True));v=next(s for s in probe['streams'] if s['codec_type']=='video');au=next(s for s in probe['streams'] if s['codec_type']=='audio')
if int(v['nb_frames'])!=total or float(au['duration'])<offset+audio_duration-.005:raise ValueError('Encoded preview failed timing verification')
partial.replace(out)
assert ''.join(x['text']for x in cues)==line['text'];out.with_suffix('.cues.json').write_text(json.dumps(cues,ensure_ascii=False,indent=2))
out.with_suffix('.assembly.json').write_text(json.dumps({**d,'actualFrames':total,'actualSeconds':duration,'canonicalText':line['text'],'audio':audio,'audioSeconds':audio_duration,'resources':stats,'status':'CONTINUITY_PREVIEW_NOT_FINAL_FILM'},ensure_ascii=False,indent=2));print(json.dumps({'file':str(out),'frames':total,'seconds':duration,'dialogue':line['text']},ensure_ascii=False))
