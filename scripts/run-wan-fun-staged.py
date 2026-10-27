"""Run guarded WAN stages serially with file logs, never an output pipe or retry."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('request', type=Path)
    parser.add_argument('--visual-input', type=Path, help='Explicit recovery: start at sampling with existing visual conditions; worker validates request hash and stage.')
    args = parser.parse_args()
    root = args.request.parent
    report_path = root / 'run.json'
    if report_path.exists():
        raise ValueError('Existing run: inspect it; no automatic restart')
    report = dict(status='RUNNING', pid=os.getpid(), stages=[], productionApproved=False)

    def save():
        partial = report_path.with_suffix('.partial.json')
        partial.write_text(json.dumps(report, indent=2) + '\n')
        partial.replace(report_path)

    prior = args.visual_input
    if prior is not None:
        if not prior.is_file():raise ValueError('Recovery visual conditions missing')
        report['recoveryVisualInput']=str(prior)
    try:
        for stage in (['sample','decode'] if prior is not None else ['text', 'visual', 'sample', 'decode']):
            output = root / ('decoded.pt' if stage == 'decode' else stage + '.pt')
            command = [sys.executable, str(Path(__file__).with_name('wan-fun-staged-worker.py')),
                       str(args.request), '--stage', stage, '--output', str(output)]
            if prior:
                command += ['--input', str(prior)]
            if stage == 'decode':
                command += ['--spatial-tiled-decode', '--png-only']
            item = dict(stage=stage, status='RUNNING', output=str(output))
            report['stages'].append(item)
            save()
            with (root / (stage + '.log')).open('x') as log:
                with subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=log) as process:
                    item['pid'] = process.pid
                    save()
                    code = process.wait()
            item['returncode'] = code
            if code or not output.is_file():
                item['status'] = 'FAILED'
                raise RuntimeError(f'{stage} failed; inspect its log and resource receipt')
            item['status'] = 'COMPLETE'
            prior = output
            save()
        report['status'] = 'RECOVERY_STAGES_COMPLETE_REVIEW_REQUIRED' if args.visual_input else 'ALL_STAGES_COMPLETE_REVIEW_REQUIRED'
    except BaseException as error:
        report.update(status='STOPPED_NO_AUTOMATIC_RETRY', error=f'{type(error).__name__}: {error}')
        raise
    finally:
        save()


if __name__ == '__main__':
    main()
