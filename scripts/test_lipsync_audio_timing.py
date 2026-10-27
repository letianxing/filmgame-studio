import unittest
from types import SimpleNamespace
import numpy as np
from lipsync_audio_timing import feature_indices, timestamp_chunks, audio_timing_adapter


class AudioTimingTests(unittest.TestCase):
    def test_same_timestamp_has_same_context_across_rates(self):
        self.assertEqual(feature_indices(16,16), list(range(46,56)))
        self.assertEqual(feature_indices(16,16), feature_indices(25,25))

    def test_25fps_matches_existing_window_contract(self):
        for frame in range(50):
            self.assertEqual(feature_indices(frame,25), list(range(frame*2-4,frame*2+6)))

    def test_boundaries_are_zero_padded_without_wrapping(self):
        source=np.arange(1,101,dtype=np.float32).reshape(1,100,1,1)
        chunks=timestamp_chunks(source,32000,fps=16,backend=np)
        self.assertEqual(chunks.shape,(32,10,1))
        np.testing.assert_array_equal(chunks[0,:,0],[0,0,0,0,1,2,3,4,5,6])
        np.testing.assert_array_equal(chunks[16,:,0],np.arange(47,57))
        self.assertEqual(chunks[-1,-1,0],0)

    def test_adapter_restores_upstream_after_failure(self):
        original=object(); module=SimpleNamespace(get_whisper_chunk=original)
        with self.assertRaises(RuntimeError):
            with audio_timing_adapter(module):
                self.assertIs(module.get_whisper_chunk,timestamp_chunks)
                raise RuntimeError('test')
        self.assertIs(module.get_whisper_chunk,original)


if __name__=='__main__':unittest.main()
