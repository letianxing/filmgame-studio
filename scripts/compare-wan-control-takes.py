"""Matched-frame, unwarped A/B contact sheets; no automated quality approval."""
import argparse,json,hashlib
from pathlib import Path
from PIL import Image,ImageDraw


def main():
    p=argparse.ArgumentParser();p.add_argument('--baseline',required=True);p.add_argument('--candidate',required=True);p.add_argument('--output-dir',required=True);a=p.parse_args()
    roots=[Path(a.baseline),Path(a.candidate)];requests=[json.loads((r/'request.json').read_text()) for r in roots];out=Path(a.output_dir)
    if out.exists():raise ValueError('Output exists')
    for key in ['frames','fps','width','height','seed','referenceSha256','controlSha256','positive','negative','steps','shift','scheduleMode','referenceTimestepPolicy','contentRectangle']:
        if requests[0].get(key)!=requests[1].get(key):raise ValueError('Not a matched guidance comparison: '+key)
    frames=requests[0]['frames']
    if frames!=49 or (requests[0]['width'],requests[0]['height'])!=(768,448):raise ValueError('Unsupported reviewed crop layout')
    indexes=[0,6,12,18,24,30,36,42,48]
    crops={'kongming-head':(490,20,610,140),'kongming-grip':(480,140,600,260),'zhang-head':(180,35,280,135)}
    out.mkdir();pages=[]
    for region,box in crops.items():
        for start in range(0,len(indexes),3):
            sheet=Image.new('RGB',(720,3*260),'#171717');draw=ImageDraw.Draw(sheet)
            for row,index in enumerate(indexes[start:start+3]):
                sources=[roots[0]/'decoded-frames/frame-000.png',*(r/f'decoded-frames/frame-{index:03d}.png' for r in roots)]
                for column,path in enumerate(sources):
                    with Image.open(path) as im:
                        if im.size!=(768,448):raise ValueError('Frame size mismatch')
                        sheet.paste(im.crop(box).resize((240,240),Image.Resampling.NEAREST),(column*240,row*260))
                    label=['source frame 0',f'CFG {requests[0]["cfg"]}',f'CFG {requests[1]["cfg"]}'][column]
                    draw.text((column*240+5,row*260+243),f'{label} | {index:03d}',fill='white')
            page=out/f'{region}-{start:02d}.png';sheet.save(page);pages.append(str(page))
    result={'status':'MATCHED_COMPARISON_PREPARED_NOT_APPROVAL','baseline':a.baseline,'candidate':a.candidate,'framesCompared':indexes,'columns':['baseline first frame','baseline same timestamp','candidate same timestamp'],'crops':crops,'pages':pages,'productionApproved':False,'limitations':['Unwarped crops retain pose variation; no claim that image difference alone measures identity.','Static sheets do not replace original-speed motion and audio review.']}
    (out/'manifest.json').write_text(json.dumps(result,indent=2)+'\n')


if __name__=='__main__':main()
