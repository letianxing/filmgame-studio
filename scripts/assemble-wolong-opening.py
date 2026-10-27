"""Reproducible editorial assembly for the approved Wolong opening.

Preserves generated dialogue. Replaces a low-framed portion of Zhang Zhao's
question with a unique Kongming listening insert from the same take.
"""
import argparse,json,subprocess
from pathlib import Path
from media_resource_guard import bounded_media

def run_media(command):
 with bounded_media(command, root) as (process, stats):
  process.wait()
 print(json.dumps(stats))
p=argparse.ArgumentParser()
p.add_argument('--folder',required=True)
p.add_argument('--ffmpeg',default='ffmpeg')
p.add_argument('--codec',default='libx264')
a=p.parse_args(); root=Path(a.folder).resolve()
# Audio stays in original question order; the listening insert is not reused.
edits=[('arrival',0,30,0),('introductions',0,29,0),('first-question',0,12,0),('first-question',27,30,12),('first-question',15,27,15),('answer-reactions',0,10.25,0),('answer-reactions',20,30,20)]
work=root/'edit';work.mkdir(exist_ok=True)
manifest=[];position=0
for i,(name,start,stop,audio_start) in enumerate(edits):
 length=stop-start;target=work/f'cut-{i+1:02}.mp4'
 audio_filter=f'atrim=start={audio_start}:duration={length},asetpts=PTS-STARTPTS,aresample=48000'
 if i==0: audio_filter+=",volume=0.4:enable='lt(t,5)'"
 audio_filter+=f',afade=t=in:d=0.015,afade=t=out:st={length-.015}:d=0.015'
 filters=f'[0:v]trim=start={start}:end={stop},setpts=PTS-STARTPTS,fps=24,format=yuv420p[v];[0:a]{audio_filter}[a]'
 run_media([a.ffmpeg,'-v','error','-y','-filter_complex_threads','1','-threads','2','-i',str(root/'raw'/f'{name}.mp4'),'-filter_complex',filters,'-map','[v]','-map','[a]','-t',str(length),'-c:v',a.codec,'-threads','2','-b:v','6000k','-c:a','aac','-ar','48000','-ac','2','-b:a','192k',str(target)])
 manifest.append(dict(segment=name,videoIn=start,videoOut=stop,audioIn=audio_start,audioOut=audio_start+length,timelineIn=position,timelineOut=position+length,file=str(target.relative_to(root))))
 position+=length
(work/'concat.txt').write_text(''.join(f"file 'cut-{i+1:02}.mp4'\n" for i in range(len(edits))))
run_media([a.ffmpeg,'-v','error','-y','-f','concat','-safe','0','-i',str(work/'concat.txt'),'-c','copy','-movflags','+faststart',str(root/'opening-assembled.mp4')])
(root/'edit-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps({'duration':position,'cuts':len(edits)}))
