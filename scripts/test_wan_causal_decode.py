import unittest
import mlx.core as mx
from wan_causal_decode import decode_causal

class CausalDecodeTests(unittest.TestCase):
    def test_rejects_other_vae_families_before_model_access(self):
        with self.assertRaises(ValueError):decode_causal(None,mx.zeros((1,48,1,2,2)))
    def test_rejects_unbounded_temporal_or_spatial_inputs(self):
        for shape in [(1,16,18,2,2),(1,16,1,65,65)]:
            with self.assertRaises(ValueError):decode_causal(None,mx.zeros(shape))

if __name__=='__main__':unittest.main()
