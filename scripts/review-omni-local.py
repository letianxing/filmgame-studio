"""Local MiniCPM-o evidence collector. Never approves or mutates Studio assets.

Uses the upstream llama.cpp-omni legacy HTTP protocol, with TTS disabled.
Frames are sampled; full audio is retained. This is NOT exhaustive motion QA.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
import subprocess
import time
import urllib.request
import wave


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def post(base, route, payload):
    request = urllib.request.Request(base + route, json.dumps(payload).encode(),
                                     {'Content-Type': 'application/json'})
    # Local model requests must never travel through a configured proxy.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return opener.open(request, timeout=180)


def temporal_issues(text, start, seconds):
    issues = []
    for minutes, sec in re.findall(r'(?<!\d)(\d{1,3}):(\d{2})(?!\d)', text):
        value = int(minutes)*60 + int(sec)
        if value < start or value > start + seconds + .05:
            issues.append(f'Model timestamp {minutes}:{sec} outside submitted window')
    return sorted(set(issues))


def run_command(args):
    subprocess.run(args, check=True, timeout=120, capture_output=True)


def prepare(source, work, start, seconds, fps, ffmpeg='ffmpeg', ffprobe='ffprobe'):
    if not (0 < seconds <= 30 and 1 <= fps <= 8 and start >= 0):
        raise ValueError('Use a 0–30 second window, 1–8 sampled FPS, nonnegative start')
    info = json.loads(subprocess.check_output(
        [ffprobe, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(source)],
        timeout=30))
    if not any(s['codec_type'] == 'audio' for s in info['streams']):
        raise ValueError('No audio stream; cannot report joint AV review')
    duration = float(info['format']['duration'])
    if start >= duration:
        raise ValueError('Window starts after media end')
    seconds = min(seconds, duration - start)
    work.mkdir(parents=True, exist_ok=False)
    common = [ffmpeg, '-v', 'error', '-threads', '2', '-filter_threads', '1',
              '-ss', str(start), '-i', str(source), '-t', str(seconds)]
    run_command(common + ['-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(work/'audio.wav')])
    run_command(common + ['-an', '-vf', f'fps={fps},scale=448:-2', '-threads', '2', str(work/'frame-%04d.png')])
    chunks = []
    frames = sorted(work.glob('frame-*.png'))
    audio_frames = 0
    with wave.open(str(work/'audio.wav'), 'rb') as src:
        for i, frame in enumerate(frames):
            # Include the final fractional tail even if fps rounds down a frame.
            data = src.readframes(src.getnframes() if i == len(frames)-1 else round(16000 / fps))
            if not data:
                raise ValueError('Frame/audio chunk coverage mismatch')
            timestamp = start + audio_frames / 16000
            audio_frames += len(data) // 2
            audio = work / f'audio-{i+1:04d}.wav'
            with wave.open(str(audio), 'wb') as dest:
                dest.setnchannels(1)
                dest.setsampwidth(2)
                dest.setframerate(16000)
                dest.writeframes(data)
            chunks.append({'time': timestamp, 'audio': str(audio.resolve()), 'frame': str(frame.resolve())})
        if audio_frames != src.getnframes():
            raise ValueError('Incomplete audio coverage')
    evidence = {'schema': 1, 'source': str(source.resolve()), 'sha256': sha256(source),
                'windowStart': start, 'windowSeconds': seconds, 'sampledFps': fps,
                'audioSecondsPrepared': audio_frames/16000,
                'chunks': chunks, 'fullMotionVerified': False, 'approval': 'NOT_APPROVED',
                'limitations': ['Temporal visual sampling can miss brief defects.',
                                'Model assertions require calibration against known examples.']}
    (work/'input.json').write_text(json.dumps(evidence, indent=2), encoding='utf-8')
    return evidence


def review(evidence, work, base, prompt, model_dir):
    if sha256(evidence['source']) != evidence['sha256']:
        raise ValueError('Source changed after preparation')
    result = dict(evidence, reviewer='AGENT_MINICPM_O_LOCAL', completed=False, observations=[], submittedChunks=0,
                  promptSha256=hashlib.sha256(prompt.encode('utf-8')).hexdigest(),
                  modelDirectory=str(model_dir.resolve()))
    started = time.monotonic()
    try:
        timing = (f"\n实际片段为 {evidence['windowStart']:.3f} 秒至 "
                  f"{evidence['windowStart']+evidence['windowSeconds']:.3f} 秒。"
                  f"共 {len(evidence['chunks'])} 张采样图，每秒 {evidence['sampledFps']} 张，"
                  "音轨连续。图片数量不是秒数。所有时间必须在该范围内，不能虚构画外事件。")
        with post(base, '/v1/stream/omni_init', {
            'media_type': 2, 'use_tts': False, 'duplex_mode': False,
            'model_dir': str(model_dir.resolve()).replace('\\', '/'), 'n_predict': 768,
            'output_dir': str(work.resolve()),
            # Some bundled legacy builds ignore prefill.text. Put the task in
            # the supported system override as well, and calibrate compliance.
            'voice_clone_prompt': '<|im_start|>system\n你是音视频观察助手，只依据输入记录事实，不猜测身份。用中文回答。\n<|im_end|>\n',
            'assistant_prompt': '<|im_start|>user\n' + prompt + timing + '\n/no_think\n',
        }) as response:
            if not json.load(response).get('success'):
                raise RuntimeError('Model initialization did not succeed')
        # In non-duplex/no-TTS mode initialize the system template explicitly.
        with post(base, '/v1/stream/prefill', {'cnt': 0, 'audio_path_prefix': '', 'text': 'Review the following audiovisual sequence.'}) as response:
            if not json.load(response).get('success'):
                raise RuntimeError('System prefill failed')
        for i, chunk in enumerate(evidence['chunks'], 1):
            with post(base, '/v1/stream/prefill', {
                'cnt': i, 'audio_path_prefix': chunk['audio'], 'img_path_prefix': chunk['frame'],
                'max_slice_nums': 1, 'text': f"Time {chunk['time']:.3f}s. " + (prompt if i == 1 else ''),
            }) as response:
                if not json.load(response).get('success'):
                    raise RuntimeError(f'Media prefill failed at {i}')
            result['submittedChunks'] = i
        with post(base, '/v1/stream/decode', {'stream': True, 'debug_dir': str(work.resolve())}) as response:
            for line in response:
                text = line.decode('utf-8').strip()
                if text.startswith('data:') and text[5:].strip() != '[DONE]':
                    item = json.loads(text[5:])
                    result['observations'].append(item)
                    if item.get('error'):
                        raise RuntimeError(f'Model decode error: {item["error"]}')
        if not any(item.get('content') for item in result['observations']):
            raise RuntimeError('Model produced no text evidence')
        text = ''.join(item.get('content', '') for item in result['observations'])
        result['evidenceIssues'] = temporal_issues(text, evidence['windowStart'], evidence['windowSeconds'])
        if len(text.split('</think>')[-1].strip()) < 80:
            result['evidenceIssues'].append('Response too short for the requested multi-dimension review; inspect for acknowledgement-only output')
        result['evidenceStatus'] = 'INVALID_OR_INCOMPLETE' if result['evidenceIssues'] else 'UNCALIBRATED_ADVISORY'
        result['completed'] = True
    except Exception as error:
        result['error'] = str(error)
        raise
    finally:
        result['elapsedSeconds'] = time.monotonic() - started
        (work/'review.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', type=Path, required=True)
    p.add_argument('--work', type=Path, required=True)
    p.add_argument('--start', type=float, default=0)
    p.add_argument('--seconds', type=float, default=6)
    p.add_argument('--fps', type=int, default=2)
    p.add_argument('--endpoint', default='http://127.0.0.1:19080')
    p.add_argument('--prepare-only', action='store_true')
    p.add_argument('--prompt-file', type=Path)
    p.add_argument('--model-dir', type=Path)
    args = p.parse_args()
    evidence = prepare(args.input, args.work, args.start, args.seconds, args.fps)
    if not args.prepare_only:
        if not args.prompt_file or not args.model_dir:
            p.error('--prompt-file and --model-dir are required for inference')
        review(evidence, args.work, args.endpoint, args.prompt_file.read_text(encoding='utf-8'), args.model_dir)
    print(json.dumps({'work': str(args.work), 'preparedFrames': len(evidence['chunks']), 'approved': False}))
