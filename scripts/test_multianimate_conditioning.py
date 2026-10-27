import unittest
import torch
from multianimate_conditioning import first_block_condition


class ConditioningTest(unittest.TestCase):
    def test_cfg_order_and_input_preservation_cpu_and_mps(self):
        devices=['cpu']+(['mps'] if torch.backends.mps.is_available() else [])
        for device in devices:
            for flags in ([0,1],[1,0],[0],[1]):
                with self.subTest(device=device,flags=flags):
                    x=torch.ones((len(flags)*2,3,5120),device=device,dtype=torch.float16)
                    condition=torch.full((1,3,5120),2.,device=device,dtype=torch.float16)
                    args={'img':x,'transformer_options':{'block_index':0,'cond_or_uncond':flags}}
                    result=first_block_condition(condition)(args,{'original_block':lambda a:{'img':a['img']}})['img']
                    for i,flag in enumerate(flags):
                        self.assertTrue(torch.all(result[i*2:i*2+2]==(3 if flag==0 else 1)).item())
                    self.assertTrue(torch.all(x==1).item())
    def test_missing_labels_wrong_block_and_grid_rejected(self):
        apply=first_block_condition(torch.zeros(1,3,5120))
        for opts,shape in [({'block_index':0},(1,3,5120)),({'block_index':1,'cond_or_uncond':[0]},(1,3,5120)),({'block_index':0,'cond_or_uncond':[0]},(1,4,5120))]:
            with self.assertRaises(ValueError):
                apply({'img':torch.zeros(shape),'transformer_options':opts},{'original_block':lambda a:a})
    def test_wrong_model_width_and_nonfinite_rejected(self):
        for condition in [torch.zeros(1,3,3072),torch.full((1,3,5120),float('nan'))]:
            with self.assertRaises(ValueError):first_block_condition(condition)


if __name__=='__main__':unittest.main()
