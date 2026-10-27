import unittest
import torch
from wan22_first_frame import anchor_first_frame


class FirstFrameTests(unittest.TestCase):
    def test_anchor_and_denoising_mask_preserve_future_frames(self):
        source=torch.zeros(1,48,3,2,2);reference=torch.ones(1,48,1,2,2)*.25
        result=anchor_first_frame({'samples':source},reference)
        self.assertTrue(torch.equal(result['samples'][:,:,:1],reference))
        self.assertEqual(result['samples'][:,:,1:].count_nonzero(),0)
        self.assertEqual(source.count_nonzero(),0)
        self.assertEqual(result['noise_mask'][:,:,:1].count_nonzero(),0)
        self.assertTrue((result['noise_mask'][:,:,1:]==1).all())

    def test_wrong_vae_contract_rejected(self):
        with self.assertRaises(ValueError):anchor_first_frame({'samples':torch.zeros(1,16,3,2,2)},torch.zeros(1,16,1,2,2))

    def test_nonfinite_anchor_rejected(self):
        with self.assertRaises(ValueError):anchor_first_frame({'samples':torch.zeros(1,48,3,2,2)},torch.full((1,48,1,2,2),float('nan')))


if __name__=='__main__':unittest.main()
