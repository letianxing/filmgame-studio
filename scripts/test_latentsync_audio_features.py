import unittest
import numpy as np
from latentsync_audio_features import window_indices,feature_windows


class FeatureTests(unittest.TestCase):
    def test_boundaries_repeat_instead_of_zero_pad(self):
        self.assertEqual(window_indices(0,20),[0,0,0,0,0,1,2,3,4,5])
        self.assertEqual(window_indices(10,20),[16,17,18,19,19,19,19,19,19,19])

    def test_audio_time_and_hidden_layer_order(self):
        values=np.arange(100*5*384,dtype=np.float32).reshape(1,100,5,384)
        result=feature_windows(values,32000,50)
        self.assertEqual(result.shape,(50,50,384))
        np.testing.assert_array_equal(result[25],values[0,46:56].reshape(50,384))

    def test_no_implicit_loop_or_extra_frames(self):
        values=np.zeros((1,100,5,384),np.float32)
        with self.assertRaises(ValueError):feature_windows(values,32000,52)
        with self.assertRaises(ValueError):window_indices(0,100,fps=16)


if __name__=='__main__':unittest.main()
