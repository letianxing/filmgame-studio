"""Meaningful local tests: audio tail, provenance, and missing-audio rejection."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
import wave
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('review_omni', Path(__file__).with_name('review-omni-local.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ReviewTests(unittest.TestCase):
    def test_invented_timeline_is_rejected(self):
        self.assertTrue(module.temporal_issues('[00:03-00:14]', 0, 6))
        self.assertEqual(module.temporal_issues('[00:03-00:05]', 0, 6), [])

    def test_audio_tail_and_changed_source(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            video = root/'sample.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=24',
                            '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=16000', '-t', '1.13',
                            '-threads', '1', str(video)], check=True, timeout=30)
            evidence = module.prepare(video, root/'prepared', 0, 1.13, 2)
            with wave.open(str(root/'prepared/audio.wav')) as original:
                expected = original.readframes(original.getnframes())
            actual = bytearray()
            for chunk in evidence['chunks']:
                with wave.open(chunk['audio']) as audio:
                    actual.extend(audio.readframes(audio.getnframes()))
            self.assertEqual(actual, expected)
            self.assertFalse(evidence['fullMotionVerified'])
            with patch.object(module, 'post') as request:
                with self.assertRaisesRegex(ValueError, 'requires 1 sampled FPS'):
                    module.review(evidence, root/'prepared', 'http://127.0.0.1:1', 'test', root)
                request.assert_not_called()
            video.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'Source changed'):
                module.review(evidence, root/'prepared', 'http://127.0.0.1:1', 'test', root)

    def test_no_audio_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            video = root/'silent.mp4'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=160x90:r=24',
                            '-t', '1', '-threads', '1', str(video)], check=True, timeout=30)
            with self.assertRaisesRegex(ValueError, 'No audio'):
                module.prepare(video, root/'prepared', 0, 1, 2)


if __name__ == '__main__':
    unittest.main()
