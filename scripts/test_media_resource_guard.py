import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from media_resource_guard import bounded_media

class ResourceGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
    def run_job(self, script, **limits):
        with bounded_media([sys.executable, '-c', script], self.root, **limits) as (process, stats):
            process.wait()
        return stats
    def test_success_releases_lock(self):
        self.run_job('pass')
        self.run_job('pass')
    def test_failure_is_not_success(self):
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_job('raise SystemExit(3)')
    def test_excludes_concurrent_job(self):
        with bounded_media([sys.executable, '-c', 'import time; time.sleep(.2)'], self.root):
            with self.assertRaisesRegex(RuntimeError, 'Another guarded'):
                self.run_job('pass')
    def test_disk_preflight_prevents_launch(self):
        with patch('media_resource_guard.shutil.disk_usage') as disk:
            disk.return_value.free = 0
            with self.assertRaisesRegex(RuntimeError, 'disk headroom'):
                self.run_job('raise RuntimeError("must not launch")')
    def test_memory_limit_terminates_process(self):
        with self.assertRaisesRegex(RuntimeError, 'RSS limit'):
            self.run_job('import time; data=bytearray(40*1024**2); time.sleep(10)', max_rss_mb=20)
    def test_timeout_terminates_process(self):
        with self.assertRaisesRegex(RuntimeError, 'time limit'):
            self.run_job('import time; time.sleep(10)', timeout=.1)

if __name__ == '__main__':
    unittest.main()
