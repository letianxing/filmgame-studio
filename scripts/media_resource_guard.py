"""Bound one local media subprocess; fail closed before exhausting the workstation."""
import contextlib
import fcntl
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import threading
import time

@contextlib.contextmanager
def bounded_media(command, output_dir, *, max_rss_mb=1024, min_free_gb=2, timeout=1800, stdin=None, stdout=None, stderr=None, minimum_available_gb=None, max_swap_growth_gb=None):
    if min(max_rss_mb, timeout) <= 0 or min_free_gb < 0:
        raise ValueError('Invalid resource limits')
    lock_path = Path(tempfile.gettempdir()) / f'filmgame-media-{os.getuid()}.lock'
    with lock_path.open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Another guarded FilmGame media job is running') from None
        def disk_ok():
            return shutil.disk_usage(output_dir).free >= min_free_gb * 1024**3
        if not disk_ok():
            raise RuntimeError('Insufficient disk headroom for media job')
        monitor = None
        if minimum_available_gb is not None or max_swap_growth_gb is not None:
            import psutil
            monitor = psutil
            if minimum_available_gb is not None and monitor.virtual_memory().available < minimum_available_gb * 1024**3:
                raise RuntimeError('Insufficient available system memory to start model')
        initial_swap = monitor.swap_memory().used if monitor else 0
        started = time.monotonic()
        process = subprocess.Popen(command, stdin=stdin, stdout=stdout, stderr=stderr, start_new_session=True)
        stopped = threading.Event()
        stats = {'peakRssMb': 0, 'maxRssMb': max_rss_mb, 'failure': None}
        if monitor:
            stats['minimumAvailableGb'] = monitor.virtual_memory().available / 1024**3
            stats['peakSwapGrowthGb'] = 0
        def kill():
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        def watch():
            while not stopped.is_set() and process.poll() is None:
                try:
                    value = subprocess.check_output(['ps', '-o', 'rss=', '-p', str(process.pid)], text=True, timeout=3).strip()
                    rss = int(value) / 1024
                    stats['peakRssMb'] = max(stats['peakRssMb'], rss)
                    if monitor:
                        available = monitor.virtual_memory().available
                        swap_growth = monitor.swap_memory().used - initial_swap
                        stats['minimumAvailableGb'] = min(stats['minimumAvailableGb'], available / 1024**3)
                        stats['peakSwapGrowthGb'] = max(stats['peakSwapGrowthGb'], swap_growth / 1024**3)
                    if rss > max_rss_mb:
                        stats['failure'] = 'Media process exceeded RSS limit'
                    elif monitor and minimum_available_gb is not None and available < minimum_available_gb * 1024**3:
                        stats['failure'] = 'Available system RAM below model safety floor'
                    elif monitor and max_swap_growth_gb is not None and swap_growth > max_swap_growth_gb * 1024**3:
                        stats['failure'] = 'Swap growth exceeded model safety budget'
                    elif not disk_ok():
                        stats['failure'] = 'Disk headroom fell below limit'
                    elif time.monotonic() - started > timeout:
                        stats['failure'] = 'Media job exceeded time limit'
                except Exception as error:
                    if process.poll() is None:
                        stats['failure'] = f'Resource monitor failed: {type(error).__name__}'
                if stats['failure']:
                    kill()
                    return
                stopped.wait(.5)
        watcher = threading.Thread(target=watch, daemon=True)
        watcher.start()
        try:
            yield process, stats
            if process.stdin and not process.stdin.closed:
                process.stdin.close()
            code = process.wait(timeout=timeout)
            if stats['failure']:
                raise RuntimeError(stats['failure'])
            if code:
                raise subprocess.CalledProcessError(code, command)
        except BaseException as error:
            kill()
            process.wait()
            if stats['failure']:
                raise RuntimeError(stats['failure']) from error
            raise
        finally:
            stopped.set()
            watcher.join(timeout=4)
            if process.stdin and not process.stdin.closed:
                process.stdin.close()
            stats['elapsedSeconds'] = round(time.monotonic() - started, 2)
