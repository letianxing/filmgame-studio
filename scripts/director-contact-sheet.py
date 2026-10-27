"""Bounded frame sampling for visual review, not a substitute for playback."""
import argparse
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from media_resource_guard import bounded_media

parser = argparse.ArgumentParser()
parser.add_argument('--input', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--ffmpeg', default='ffmpeg')
parser.add_argument('--step', type=float, default=1.5)
args = parser.parse_args()
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
if args.step <= 0:
    raise ValueError('Frame sampling step must be positive')
with bounded_media([args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-n',
                    '-threads', '2', '-filter_threads', '1', '-i', args.input,
                    '-vf', f'fps=1/{args.step},scale=384:-2', '-frames:v', '120',
                    '-threads', '2', '-q:v', '2', str(out/'frame-%03d.jpg')], out) as (process, stats):
    process.wait()
frames = sorted(out.glob('frame-*.jpg'))[:120]
for batch_start in range(0, len(frames), 20):
    batch = frames[batch_start:batch_start+20]
    sheet = Image.new('RGB', (4*384, ((len(batch)+3)//4)*242), '#0d1117')
    draw = ImageDraw.Draw(sheet)
    for j, frame in enumerate(batch):
        with Image.open(frame) as image:
            sheet.paste(image, ((j%4)*384, (j//4)*242))
        draw.text(((j%4)*384+8, (j//4)*242+218), f'{(batch_start+j)*args.step:.1f}s', fill='white')
    name = out/f'contact-{batch_start//20+1}.jpg'
    sheet.save(name, quality=92)
    print(name)
