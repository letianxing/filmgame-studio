"""Export a complete control take, removing only declared inference padding.

Preserves every generated frame and rate; never interpolates, loops or retimes.
Writes a review receipt, not a production approval.
"""
import argparse,json,subprocess
from pathlib import Path


def main():
    p=argparse.ArgumentParser();p.add_argument('run');a=p.parse_args();root=Path(a.run)
    d=json.loads((root/'request.json').read_text());out=root/'review.mp4';partial=root/'review.partial.mp4'
    if out.exists() or partial.exists():raise ValueError('Review output already exists')
    if 'width' not in d and 'inputPack' in d:
        pack=json.loads(Path(d['inputPack']).read_text())
        d={**d,'width':pack['size'][0],'height':pack['size'][1],'frames':pack['frames'],'fps':pack['fps']}
    frames=d['frames'];width,height=d['width'],d['height'];fps=d['fps']
    if not 1<=frames<=100 or not 1<=fps<=30 or width*height>1280*720:raise ValueError('Unbounded review')
    from PIL import Image,ImageDraw
    names=[root/'decoded-frames'/f'frame-{i:03d}.png' for i in range(frames)]
    for path in names:
        with Image.open(path) as im:
            if im.size!=(width,height):raise ValueError('Missing or mismatched decoded frame')
    x1,y1,x2,y2=d.get('contentRectangle',[0,0,width,height])
    if not all(type(v) is int for v in [x1,y1,x2,y2]) or not 0<=x1<x2<=width or not 0<=y1<y2<=height:
        raise ValueError('Invalid declared content rectangle')
    crop=f'crop={x2-x1}:{y2-y1}:{x1}:{y1}'
    cmd=['ffmpeg','-v','error','-nostdin','-threads','2','-filter_threads','1','-framerate',str(fps),'-i',str(root/'decoded-frames/frame-%03d.png'),'-vf',crop,'-frames:v',str(frames),'-c:v','libx264','-threads','2','-crf','18','-pix_fmt','yuv420p',str(partial)]
    from media_resource_guard import bounded_media
    with (root/'review-encoder.log').open('w') as log:
        with bounded_media(cmd,root,max_rss_mb=1024,min_free_gb=2,timeout=1800,stderr=log) as(proc,stats):proc.wait()
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-of','json',str(partial)],text=True));v=probe['streams'][0]
    if int(v['nb_frames'])!=frames or (v['width'],v['height'])!=(x2-x1,y2-y1):raise ValueError('Encoded coverage or crop mismatch')
    partial.replace(out)
    # Every frame is included across bounded contact pages for adjacent review.
    pages=[]
    for start in range(0,frames,16):
        sheet=Image.new('RGB',(4*384,4*240),'#111111');draw=ImageDraw.Draw(sheet)
        for j,i in enumerate(range(start,min(start+16,frames))):
            with Image.open(names[i]) as im:
                tile=im.crop((x1,y1,x2,y2));tile.thumbnail((384,216));sheet.paste(tile,((j%4)*384,(j//4)*240))
            draw.text(((j%4)*384+6,(j//4)*240+219),f'{i:03d}  {i/fps:.3f}s',fill='white')
        page=root/f'all-frames-{start:03d}.jpg';sheet.save(page,quality=93);pages.append(str(page))
    report={'status':'EXPORTED_FOR_REVIEW_NOT_APPROVED','video':str(out),'frames':frames,'fps':fps,'contentRectangle':[x1,y1,x2,y2],'contactPages':pages,'resources':stats,'productionApproved':False,'limitations':['Contact pages support adjacent-frame inspection; not perceptual playback or lip-sync acceptance.','No dialogue or audio added.']}
    (root/'review-export.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report),flush=True)


if __name__=='__main__':main()
