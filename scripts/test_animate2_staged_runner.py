"""Exercise orchestration without loading models or starting media processes."""
from contextlib import contextmanager, redirect_stdout
import io
import json
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch
import media_resource_guard


class RunnerTests(unittest.TestCase):
    def run_case(self, attention=None, fail=False):
        calls = []
        @contextmanager
        def fake_guard(command, *args, **kwargs):
            calls.append(command)
            class Process:
                def wait(self):
                    if fail:
                        raise RuntimeError('simulated worker failure')
                    Path(command[command.index('--output')+1]).write_bytes(b'test')
            yield Process(), {}
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)/'run'
            argv = ['runner', '--graph', str(Path(temp)/'graph.json'),
                    '--output-dir', str(output), '--comfy-home', temp,
                    '--comfy-python', 'unused', '--base-directory', temp]
            if attention:
                argv += ['--attention', attention]
            with patch('sys.argv', argv), patch.dict('os.environ'), patch.object(
                    media_resource_guard, 'bounded_media', fake_guard), redirect_stdout(io.StringIO()):
                if fail:
                    with self.assertRaisesRegex(RuntimeError, 'simulated'):
                        runpy.run_path(str(Path(__file__).with_name('run-animate2-staged.py')))
                else:
                    runpy.run_path(str(Path(__file__).with_name('run-animate2-staged.py')))
            return calls, json.loads((output/'run.json').read_text())

    def test_sdpa_is_forwarded_to_every_serial_stage(self):
        calls, report = self.run_case()
        self.assertEqual([c[c.index('--stage')+1] for c in calls], ['text','visual','sample','decode'])
        self.assertTrue(all(c[c.index('--attention')+1]=='pytorch' for c in calls))
        self.assertEqual(report['attention'], 'pytorch')

    def test_explicit_attention_is_recorded_and_forwarded(self):
        calls, report = self.run_case('split')
        self.assertTrue(all(c[c.index('--attention')+1]=='split' for c in calls))
        self.assertEqual(report['attention'], 'split')

    def test_failure_stops_without_retry_or_next_stage(self):
        calls, report = self.run_case(fail=True)
        self.assertEqual(len(calls), 1)
        self.assertEqual(report['status'], 'STOPPED_NO_AUTOMATIC_RETRY')


if __name__ == '__main__':
    unittest.main()
