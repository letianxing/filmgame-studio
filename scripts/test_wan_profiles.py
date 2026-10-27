import unittest
from wan_profiles import validate_wan_profile

class ProfileTests(unittest.TestCase):
    def setUp(self):
        self.r=dict(width=512,height=288,frames=17,steps=20,evaluationOnly=True)
        self.c=dict(dual_model=True,model_type='i2v',dim=5120,in_dim=36,num_layers=40,
                    quantization=dict(bits=4,group_size=64))
    def test_q4_comparison_has_distinct_fps_and_budget(self):
        self.assertEqual(validate_wan_profile(self.r,self.c)['fps'],16)
        self.assertEqual(validate_wan_profile(self.r,self.c)['mlxLimitGiB'],20)
    def test_large_or_unreviewed_14b_is_rejected(self):
        for request in [{**self.r,'frames':49},{**self.r,'evaluationOnly':False},
                        {**self.r,'width':768},{**self.r,'frames':16}]:
            with self.assertRaises(ValueError):validate_wan_profile(request,self.c)
        with self.assertRaises(ValueError):
            validate_wan_profile(self.r,{**self.c,'quantization':dict(bits=8,group_size=64)})
    def test_existing_5b_profile_remains_24fps(self):
        self.assertEqual(validate_wan_profile(self.r,dict(in_dim=48))['fps'],24)
    def test_lightning_allows_bounded_longer_take_but_not_arbitrary_settings(self):
        r={**self.r,'lightningDir':'configured','steps':4,'frames':65}
        self.assertEqual(validate_wan_profile(r,self.c)['fps'],16)
        with self.assertRaises(ValueError):validate_wan_profile({**r,'steps':20},self.c)
        with self.assertRaises(ValueError):validate_wan_profile({**r,'frames':81},self.c)

if __name__=='__main__':unittest.main()
