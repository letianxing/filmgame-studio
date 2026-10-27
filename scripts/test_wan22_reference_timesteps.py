import unittest
import torch
from wan22_reference_timesteps import prepend_reference_timestep,align_reference_timesteps
from types import SimpleNamespace


class ReferenceTimestepsTests(unittest.TestCase):
    def test_reference_then_clean_first_video_frame(self):
        for frames in [5,13]:
            video=torch.full((2,frames),500.);video[:,0]=0
            fixed=prepend_reference_timestep(video)
            patches=fixed.repeat_interleave(144,dim=1)
            self.assertEqual(patches.shape,(2,(frames+1)*144))
            self.assertTrue((patches[:,:144]==500).all())
            self.assertTrue((patches[:,144:288]==0).all())
            self.assertTrue((patches[:,288:]==500).all())

    def test_prefix_matches_upstream_last_timestep(self):
        actual=prepend_reference_timestep(torch.tensor([[0.,200.,300.]]))
        self.assertTrue(torch.equal(actual,torch.tensor([[300.,0.,200.,300.]])))

    def test_scope_restores_original_on_error(self):
        original=lambda timestep,x,denoise_mask=None,**kwargs:torch.tensor([[0.,500.]])
        model=SimpleNamespace(model_config=SimpleNamespace(unet_config={'in_dim':148,'out_dim':48}),diffusion_model=SimpleNamespace(ref_conv=object()),process_timestep=original)
        with self.assertRaises(RuntimeError):
            with align_reference_timesteps(model) as counts:
                actual=model.process_timestep(torch.tensor([500.]),torch.zeros(1,148,2,2,2),denoise_mask=torch.ones(1,1,2,2,2),reference_latent=torch.zeros(1,48,2,2))
                self.assertEqual(actual.shape,(1,3));self.assertEqual(counts['correctedCalls'],1)
                raise RuntimeError('test')
        self.assertIs(model.process_timestep,original)


if __name__=='__main__':unittest.main()
