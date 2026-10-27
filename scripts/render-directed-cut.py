"""Render reviewed footage with an existing soundtrack with deterministic Chinese titles and timed subtitles.

Font and media executable paths are explicit configuration. Cues must be reviewed against the audio.
"""
import argparse
import json
import subprocess
import math
from fractions import Fraction
from media_resource_guard import bounded_media
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser()
for name in ('input', 'output', 'cues', 'font'):
    parser.add_argument('--'+name, required=True)
parser.add_argument('--ffmpeg', default='ffmpeg')
parser.add_argument('--ffprobe', default='ffprobe')
parser.add_argument('--codec', default='libx264')
parser.add_argument('--title', default='夜渡')
parser.add_argument('--label', default='原创国风 · AI审片版')
parser.add_argument('--max-rss-mb', type=int, default=1024)
parser.add_argument('--nameplates', help='Timed name/courtesy-name overlays, independent of dialogue cues')
parser.add_argument('--no-title', action='store_true')
parser.add_argument('--no-fade', action='store_true')
args = parser.parse_args()
source, output = Path(args.input).resolve(), Path(args.output).resolve()
if output.exists():raise ValueError('Refusing to overwrite an existing rendered cut')
output.parent.mkdir(parents=True, exist_ok=True)
probe = json.loads(subprocess.check_output([args.ffprobe, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(source)]))
video = next(s for s in probe['streams'] if s.get('codec_type') == 'video')
if not any(s.get('codec_type') == 'audio' for s in probe['streams']):
    raise ValueError('An existing soundtrack is required; refusing to replace missing audio with silence')
width, height, duration = video['width'], video['height'], float(probe['format']['duration'])
cues = json.loads(Path(args.cues).read_text())
end = 0.0
for cue in cues:
    if not (end <= cue['start'] < cue['end'] <= duration) or not isinstance(cue['text'], str):
        raise ValueError('Subtitle timeline is invalid')
    end = cue['end']
asset_dir = output.parent/'subtitle-overlays'
asset_dir.mkdir(exist_ok=True)
font = ImageFont.truetype(args.font, max(24, round(height*.043)))
title_font = ImageFont.truetype(args.font, max(40, round(height*.079)))
small_font = ImageFont.truetype(args.font, max(14, round(height*.022)))
layers = []
for index, cue in enumerate(cues):
    image = Image.new('RGBA', (width, height))
    draw = ImageDraw.Draw(image)
    text = cue['text'].replace('\n', ' ')
    draw.text((width/2, height*.92), text, font=font, fill=(246,244,237,255), anchor='mm',
              stroke_width=max(1, round(height/360)), stroke_fill=(10,13,18,220))
    file = asset_dir/f'caption-{index:02}.png'
    image.save(file)
    layers.append((file, cue['start'], cue['end']))
if args.nameplates:
    nameplates = json.loads(Path(args.nameplates).read_text())
    previous_end = 0.0
    for index, plate in enumerate(nameplates):
        if not (previous_end <= plate['start'] < plate['end'] <= duration):
            raise ValueError('Invalid nameplate timing')
        if not all(isinstance(plate.get(k), str) and 0 < len(plate[k]) <= 12 for k in ['name','courtesyName']):
            raise ValueError('Invalid character nameplate')
        if plate.get('side','left') not in ['left','right']:raise ValueError('Invalid nameplate side')
        previous_end = plate['end']
        image = Image.new('RGBA', (width,height)); draw = ImageDraw.Draw(image)
        x = width*.065 if plate.get('side','left') == 'left' else width*.70
        y = height*.72
        draw.rounded_rectangle((x-14,y-12,x+width*.235,y+height*.125),radius=8,fill=(12,18,20,185))
        name_font = ImageFont.truetype(args.font,max(16,round(height*.047)))
        courtesy_font = ImageFont.truetype(args.font,max(12,round(height*.028)))
        draw.text((x,y),plate['name'],font=name_font,fill=(240,223,185,255),stroke_width=1,stroke_fill=(10,13,18,200))
        draw.text((x,y+height*.065),'字 '+plate['courtesyName'],font=courtesy_font,fill=(236,232,221,255))
        file=asset_dir/f'nameplate-{index:02}.png';image.save(file)
        layers.append((file,plate['start'],plate['end']))
if not args.no_title:
    image = Image.new('RGBA', (width, height))
    draw = ImageDraw.Draw(image)
    draw.text((width*.085, height*.13), args.title, font=title_font, fill=(235,224,204,255), anchor='lm', stroke_width=1, stroke_fill=(14,16,18,180))
    draw.text((width*.085, height*.21), args.label, font=small_font, fill=(215,210,198,255), anchor='lm', stroke_width=1, stroke_fill=(14,16,18,160))
    file = asset_dir/'title.png'; image.save(file); layers.append((file, 0.4, 2.5))
# Stream exactly one RGBA overlay input. Memory does not grow with subtitle count.
fps = Fraction(video['r_frame_rate'])
if not (0 < fps <= 60) or width * height > 3840 * 2160:
    raise ValueError('Unsupported frame rate or resolution for bounded local rendering')
vfade = '' if args.no_fade else f',fade=t=out:st={max(0,duration-.5)}:d=0.5'
afade = '' if args.no_fade else f',afade=t=out:st={max(0,duration-.5)}:d=0.5'
filters = f"[0:v][1:v]overlay=shortest=1{vfade},format=yuv420p[vout];[0:a]loudnorm=I=-16:TP=-1.5:LRA=11{afade}[aout]"
partial = output.with_name(output.stem + '.partial.mp4')
cmd = [args.ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', '-filter_complex_threads', '1',
       '-threads', '2', '-i', str(source), '-f', 'rawvideo', '-pixel_format', 'rgba',
       '-video_size', f'{width}x{height}', '-framerate', str(fps), '-threads', '1', '-i', 'pipe:0',
       '-filter_complex', filters, '-map', '[vout]', '-map', '[aout]', '-t', str(duration),
       '-c:v', args.codec, '-threads', '2', '-b:v', '6000k', '-pix_fmt', 'yuv420p',
       '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k', '-movflags', '+faststart', str(partial)]
try:
    with bounded_media(cmd, output.parent, max_rss_mb=args.max_rss_mb, stdin=subprocess.PIPE) as (process, stats):
        previous_active, pixels = None, None
        for frame in range(math.ceil(duration * fps)):
            moment = float(frame / fps)
            active = tuple(i for i, (_, start, stop) in enumerate(layers) if start <= moment < stop)
            if active != previous_active:
                overlay = Image.new('RGBA', (width, height))
                for i in active:
                    with Image.open(layers[i][0]) as layer:
                        overlay.alpha_composite(layer)
                pixels = overlay.tobytes()
                previous_active = active
            process.stdin.write(pixels)
    partial.replace(output)
except BaseException:
    partial.unlink(missing_ok=True)
    raise
output.with_suffix('.resources.json').write_text(json.dumps(stats, indent=2))
print(json.dumps({'file': str(output), 'duration': duration, 'width': width, 'height': height, 'subtitleCues': len(cues), 'resources': stats}, ensure_ascii=False))
