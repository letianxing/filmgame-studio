import unittest
import torch
from torch.nn.functional import scaled_dot_product_attention as sdpa
from spatial_attention_batching import batch_sliced_attention,spatial_attention_batches


class SpatialBatchTests(unittest.TestCase):
    def test_independent_batches_match_reference(self):
        torch.manual_seed(1);torch.set_num_threads(2)
        q=torch.randn(5,2,33,8);k=torch.randn(5,2,17,8);v=torch.randn_like(k)
        for device in ['cpu']+(['mps'] if torch.backends.mps.is_available() else []):
            inputs=[x.to(device) for x in (q,k,v)]
            expected=sdpa(*inputs)
            actual=batch_sliced_attention(sdpa,*inputs,batch_size=2,minimum_tokens=1)
            torch.testing.assert_close(actual,expected,rtol=1e-5,atol=1e-6)

    def test_temporal_window_is_not_split(self):
        calls=[]
        def original(q,k,v,**kwargs):calls.append(q.shape);return q
        q=torch.ones(40,2,16,8)
        batch_sliced_attention(original,q,q,q)
        self.assertEqual(calls,[q.shape])

    def test_masked_attention_uses_original_path(self):
        calls=[]
        def original(q,k,v,**kwargs):calls.append(q.shape);return q
        q=torch.ones(4,1,32,8)
        batch_sliced_attention(original,q,q,q,minimum_tokens=1,attn_mask=torch.ones(32,32))
        self.assertEqual(calls,[q.shape])

    def test_scope_restores_api_after_failure(self):
        import torch.nn.functional as f
        old=f.scaled_dot_product_attention
        with self.assertRaises(RuntimeError):
            with spatial_attention_batches():raise RuntimeError('test')
        self.assertIs(f.scaled_dot_product_attention,old)


if __name__=='__main__':unittest.main()
