#!/usr/bin/env python3
"""Export sample-exact scene dialogue stems; never invent action-scene timing."""
import argparse
import hashlib
import json
from pathlib import Path
import wave


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def stamp(sample, rate):
    ms = round(sample * 1000 / rate)
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--script', type=Path, required=True)
    parser.add_argument('--timeline', type=Path, required=True)
    parser.add_argument('--audio', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    script = json.loads(args.script.read_text())
    timeline = json.loads(args.timeline.read_text())
    assert digest(args.script) == timeline['scriptSha256'], 'Stale script binding'
    scenes = script['content']['scenes']
    canonical = [(s['id'], d['characterId'], d['text']) for s in scenes for d in s['dialogue']]
    actual = [(d['sceneId'], d['characterId'], d['text']) for d in timeline['lines']]
    assert canonical == actual, 'Dialogue order, actor or text mismatch'
    assert len({x['lineId'] for x in timeline['lines']}) == len(actual)
    with wave.open(str(args.audio)) as source:
        params = source.getparams()
        rate = params.framerate
        assert rate == timeline['sampleRate'] and params.nframes == timeline['samples']
        last = 0
        for line in timeline['lines']:
            assert last <= line['startSample'] < line['endSample'] <= params.nframes
            last = line['endSample']
        args.output.mkdir(parents=True, exist_ok=False)
        manifest = dict(status='SCENE_DIALOGUE_STEMS_NOT_FINAL_FILM',
                        scriptSha256=timeline['scriptSha256'], sourceAudio=str(args.audio),
                        sourceAudioSha256=digest(args.audio), lineCount=len(actual),
                        textVerified=True, listeningApproved=False,
                        timingPolicy='Original provisional dialogue timing; action duration remains unset.', scenes=[])
        for scene in scenes:
            folder = args.output / scene['id']
            folder.mkdir()
            lines = [x for x in timeline['lines'] if x['sceneId'] == scene['id']]
            entry = dict(sceneId=scene['id'], heading=scene['heading'], action=scene['action'],
                         status='DIALOGUE_READY_FOR_REVIEW' if lines else 'ACTION_ONLY_TIMING_REQUIRED',
                         pictureApproved=False, listeningApproved=False, lines=[])
            if lines:
                start, end = lines[0]['startSample'], lines[-1]['endSample']
                source.setpos(start)
                audio = folder / 'dialogue.wav'
                partial = folder / 'dialogue.partial.wav'
                h = hashlib.sha256()
                with wave.open(str(partial), 'wb') as target:
                    target.setparams(params)
                    remaining = end - start
                    while remaining:
                        count = min(remaining, rate)
                        block = source.readframes(count)
                        assert len(block) == count * params.nchannels * params.sampwidth
                        target.writeframesraw(block)
                        h.update(block)
                        remaining -= count
                with wave.open(str(partial)) as check:
                    assert check.getnframes() == end - start
                    verified = hashlib.sha256()
                    while block := check.readframes(rate):
                        verified.update(block)
                    assert verified.digest() == h.digest()
                partial.replace(audio)
                entry.update(sourceStartSample=start, sourceEndSample=end,
                             sampleRate=rate, seconds=(end-start)/rate, pcmSha256=h.hexdigest())
                subtitles = []
                for i, line in enumerate(lines, 1):
                    item = dict(line)
                    item.update(startSample=line['startSample']-start, endSample=line['endSample']-start)
                    item.update(start=item['startSample']/rate, end=item['endSample']/rate)
                    entry['lines'].append(item)
                    subtitles.append(f"{i}\n{stamp(item['startSample'], rate)} --> {stamp(item['endSample'], rate)}\n{item['text']}\n")
                (folder / 'dialogue.srt').write_text('\n'.join(subtitles))
            save(folder / 'timeline.json', entry)
            manifest['scenes'].append(dict(sceneId=scene['id'], status=entry['status'],
                                           lines=len(lines), seconds=entry.get('seconds')))
        save(args.output / 'manifest.json', manifest)
        print(json.dumps(dict(scenes=len(scenes), lines=len(actual), output=str(args.output))))


if __name__ == '__main__':
    main()
