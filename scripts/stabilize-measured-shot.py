"""Bounded global video translation correction from reviewed static-region tracks.

No face synthesis, local deformation, temporal interpolation or frame looping.
"""
import argparse, json, subprocess
from pathlib import Path
import cv2
import numpy as np
from media_resource_guard import bounded_media

p = argparse.ArgumentParser()
p.add_argument('--report', required=True)
p.add_argument('--region', required=True)
p.add_argument('--output', required=True)
a = p.parse_args()
d = json.loads(Path(a.report).read_text())
out = Path(a.output)
if out.exists() or d['referenceFrame'] != 0:
    raise ValueError('New output and first-frame reference required')
cap = cv2.VideoCapture(d['video'])
cv2.setNumThreads(1)
n, fps = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)), cap.get(cv2.CAP_PROP_FPS)
w, h = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
if not 1 < n <= 150 or w*h > 1280*720 or n != d['decodedFrames']:
    raise ValueError('Bounded complete report required')
tracks = [(0., 0.)]
for i, row in enumerate(d['frames'], 1):
    m = row['regions'][a.region]
    if row['frame'] != i or m.get('tracked', 0) < 8:
        raise ValueError('Incomplete or unresolved tracks')
    tracks.append((m['medianDx'], m['medianDy']))
if len(tracks) != n or not np.isfinite(tracks).all() or np.max(np.abs(tracks)) > 3:
    raise ValueError('Only measured translations within three pixels supported')
zoom = 1.02
if any(abs(dx)*zoom >= (zoom-1)*w/2 or abs(dy)*zoom >= (zoom-1)*h/2 for dx,dy in tracks):
    raise ValueError('Correction would expose an edge')
partial = out.with_suffix('.partial.mp4')
cmd = ['ffmpeg','-v','error','-n','-filter_threads','1','-f','rawvideo','-pix_fmt','bgr24','-s',f'{w}x{h}','-r',str(fps),'-i','pipe:0','-threads','2','-i',d['video'],'-map','0:v:0','-map','1:a?','-c:v','libx264','-threads','2','-crf','16','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',str(partial)]
with bounded_media(cmd,out.parent,stdin=subprocess.PIPE) as (proc,stats):
    for dx,dy in tracks:
        ok,frame = cap.read()
        if not ok:
            raise ValueError('Truncated input')
        matrix = np.float32([[zoom,0,(1-zoom)*w/2-zoom*dx],[0,zoom,(1-zoom)*h/2-zoom*dy]])
        fixed = cv2.warpAffine(frame,matrix,(w,h),flags=cv2.INTER_LINEAR)
        proc.stdin.write(fixed.tobytes())
    cap.release()
    proc.stdin.close()
    proc.wait()
probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(partial)],text=True))
if int(next(s for s in probe['streams'] if s['codec_type']=='video')['nb_frames']) != n:
    raise ValueError('Output frame count changed')
partial.replace(out)
receipt={'source':d['video'],'report':a.report,'region':a.region,'frames':n,'fps':fps,'uniformScale':zoom,'method':'global translation per frame, 2 percent fixed overscan; original audio stream copied','resources':stats,'status':'REQUIRES_VISUAL_AND_MOTION_REVIEW'}
out.with_suffix('.stabilization.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
