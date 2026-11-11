"""Bounded sequential AV observations; coverage is not quality acceptance."""
import argparse
import importlib.util
import json
import math
from pathlib import Path
import subprocess

spec = importlib.util.spec_from_file_location('omni', Path(__file__).with_name('review-omni-local.py'))
omni = importlib.util.module_from_spec(spec)
spec.loader.exec_module(omni)


def windows(duration, size=6, overlap=1):
    if not all(math.isfinite(x) for x in (duration, size, overlap)) or not (0 < duration <= 120 and 1 <= size <= 15 and 0 <= overlap < size):
        raise ValueError('Require finite duration <=120s, window 1–15s and overlap < window')
    result = []
    start = 0.0
    while start < duration:
        length = min(size, duration-start)
        result.append((start, length))
        if start + length >= duration:
            break
        start += size-overlap
    return result


def collect(source, work, model_dir, prompt, endpoint, size=6, overlap=1):
    duration = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
                     'format=duration', '-of', 'default=nw=1:nk=1', str(source)], timeout=30))
    plan = windows(duration, size, overlap)
    work.mkdir(parents=True, exist_ok=False)
    source_sha = omni.sha256(source)
    receipt = dict(source=str(source.resolve()), sha256=source_sha, duration=duration,
                   plannedWindows=[dict(start=s, seconds=n) for s, n in plan], windows=[],
                   approval='NOT_APPROVED', fullMotionVerified=False,
                   completeInputCoverage=False, generationCredits=0)
    try:
        for i, (start, seconds) in enumerate(plan):
            folder = work / f'window-{i:03d}'
            if omni.sha256(source) != source_sha:
                raise ValueError('Source changed during sequence review')
            evidence = omni.prepare(source, folder, start, seconds, 1)
            result = omni.review(evidence, folder, endpoint, prompt, model_dir)
            receipt['windows'].append(dict(start=start, seconds=seconds,
                evidence=str((folder/'review.json').resolve()), completed=result['completed'],
                submittedChunks=result['submittedChunks'], expectedChunks=len(evidence['chunks']),
                evidenceStatus=result['evidenceStatus'], evidenceIssues=result['evidenceIssues']))
            # Save progress after each window, including invalid model observations.
            (work/'sequence.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
        receipt['completeInputCoverage'] = all(w['completed'] and w['submittedChunks'] == w['expectedChunks'] for w in receipt['windows'])
        receipt['evidenceStatus'] = ('INVALID_OR_INCOMPLETE' if any(w['evidenceStatus'] == 'INVALID_OR_INCOMPLETE' for w in receipt['windows']) else 'UNCALIBRATED_ADVISORY')
    except Exception as error:
        receipt['error'] = str(error)
        raise
    finally:
        (work/'sequence.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    return receipt


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for name in ('input', 'work', 'model-dir', 'prompt-file'):
        p.add_argument('--'+name, type=Path, required=True)
    p.add_argument('--endpoint', default='http://127.0.0.1:19080')
    args = p.parse_args()
    result = collect(args.input, args.work, args.model_dir, args.prompt_file.read_text(encoding='utf-8'), args.endpoint)
    print(json.dumps(dict(windows=len(result['windows']), completeInputCoverage=result['completeInputCoverage'], approval=result['approval'])))
