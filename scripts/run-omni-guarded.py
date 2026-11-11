"""Run a local reviewer server for one worker command, then release its memory.

Requires psutil. No service installation, auto-download, or Studio approval.
"""
import argparse
import json
from pathlib import Path
import subprocess
import time
import urllib.request
import psutil


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--server', type=Path, required=True)
    p.add_argument('--model', type=Path, required=True)
    p.add_argument('--work', type=Path, required=True)
    p.add_argument('--port', type=int, default=19080)
    p.add_argument('--timeout', type=int, default=600)
    p.add_argument('command', nargs=argparse.REMAINDER)
    args = p.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command:
        p.error('Provide a worker command after --')
    if psutil.virtual_memory().available < 6 * 1024**3:
        raise RuntimeError('Need 6 GiB available RAM for initial model smoke test')
    gpu = subprocess.check_output(['nvidia-smi', '--query-gpu=memory.free', '--format=csv,noheader,nounits'], text=True)
    if int(gpu.splitlines()[0]) < 10500:
        raise RuntimeError('Need at least 10500 MiB free VRAM for smoke test')
    args.work.mkdir(parents=True, exist_ok=True)
    lock_root = Path(__file__).resolve().parent.parent / '.local' / 'av-review'
    lock_root.mkdir(parents=True, exist_ok=True)
    lock = lock_root / 'reviewer.lock'
    # PID evidence is kept on unexpected interruption; never silently steal a lock.
    handle = lock.open('x')
    started = time.monotonic()
    children = []
    stats = {'completed': False, 'peakRssBytes': 0, 'minimumAvailableRamBytes': psutil.virtual_memory().available}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with (args.work/'server.stdout.log').open('w', encoding='utf-8') as out, (args.work/'server.stderr.log').open('w', encoding='utf-8') as err:
            server = subprocess.Popen([str(args.server.resolve()), '-m', str(args.model.resolve()),
                '--host', '127.0.0.1', '--port', str(args.port), '-ngl', '99', '-c', '8192',
                '-t', '4', '-tb', '4', '-n', '768', '--temp', '0.2'],
                cwd=args.server.parent, stdout=out, stderr=err,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            children.append(server)
            handle.write(str(server.pid)); handle.flush()
            worker = None
            while True:
                elapsed = time.monotonic() - started
                available = psutil.virtual_memory().available
                stats['minimumAvailableRamBytes'] = min(stats['minimumAvailableRamBytes'], available)
                if server.poll() is not None:
                    raise RuntimeError(f'Server exited {server.returncode}; inspect server.stderr.log')
                stats['peakRssBytes'] = max(stats['peakRssBytes'], psutil.Process(server.pid).memory_info().rss)
                if available < 2 * 1024**3 or elapsed > args.timeout:
                    raise RuntimeError('Reviewer stopped at memory/time limit')
                if worker is None:
                    try:
                        with opener.open(f'http://127.0.0.1:{args.port}/health', timeout=1) as response:
                            ready = response.status == 200
                    except Exception:
                        ready = False
                    if ready:
                        worker = subprocess.Popen(command)
                        children.append(worker)
                elif worker.poll() is not None:
                    if worker.returncode:
                        raise RuntimeError(f'Reviewer worker exited {worker.returncode}')
                    stats['completed'] = True
                    break
                time.sleep(.5)
    except Exception as error:
        stats['error'] = str(error)
        raise
    finally:
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill(); child.wait()
        handle.close()
        lock.unlink()
        stats['elapsedSeconds'] = time.monotonic() - started
        (args.work/'resources.json').write_text(json.dumps(stats, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()
