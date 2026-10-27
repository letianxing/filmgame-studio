"""Run one explicitly configured guarded command after successful WAN completion."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
import os
import psutil


def completed(state):
    stages = state.get('stages', [])
    return (state.get('status') == 'ALL_STAGES_COMPLETE_REVIEW_REQUIRED'
            and [s.get('stage') for s in stages] == ['text','visual','sample','decode']
            and all(s.get('status') == 'COMPLETE' and s.get('returncode') == 0 for s in stages))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('configuration',type=Path);args=parser.parse_args()
    config=json.loads(args.configuration.read_text());root=args.configuration.parent
    report_path=root/'queue-run.json'
    if report_path.exists():raise ValueError('Queue already started; no retry')
    state_path=Path(config['prerequisite']);deadline=time.monotonic()+3600
    report={'status':'WAITING_FOR_WAN','pid':os.getpid(),'autoRetry':False}
    def save():
        p=report_path.with_suffix('.partial.json');p.write_text(json.dumps(report,indent=2)+'\n');p.replace(report_path)
    save()
    try:
        while True:
            state=json.loads(state_path.read_text())
            try:
                process=psutil.Process(state['pid'])
                live=process.is_running() and process.status()!=psutil.STATUS_ZOMBIE and any('run-wan-fun-staged.py' in s for s in process.cmdline())
            except psutil.NoSuchProcess:live=False
            if not live:
                if not completed(state):raise RuntimeError('Prerequisite stopped without successful completion')
                digest=hashlib.sha256((state_path.parent/'request.json').read_bytes()).hexdigest()
                for stage in state['stages']:
                    output=Path(stage['output']);receipt=json.loads(output.with_suffix('.receipt.json').read_text())
                    if not output.is_file() or receipt.get('requestSha256')!=digest or receipt.get('stage')!=stage['stage']:
                        raise RuntimeError('Missing or stale prerequisite output')
                break
            if time.monotonic()>deadline:raise TimeoutError('Prerequisite wait exceeded one hour')
            time.sleep(5)
        report['status']='RUNNING_GUARDED_COMMAND';save()
        with (root/'command.log').open('x') as log:
            with subprocess.Popen(config['command'],stdin=subprocess.DEVNULL,stdout=log,stderr=log) as child:
                report['childPid']=child.pid;save();code=child.wait()
        report['returncode']=code
        if code:raise RuntimeError('Guarded command failed; no automatic retry')
        report['status']='COMMAND_COMPLETE_REVIEW_REQUIRED'
    except BaseException as error:
        report.update(status='STOPPED_NO_RETRY',error=f'{type(error).__name__}: {error}');raise
    finally:save()


if __name__=='__main__':main()
