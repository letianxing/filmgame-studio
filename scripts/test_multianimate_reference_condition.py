import unittest
import torch
from multianimate_conditioning import reference_pose_correction


class Base:
    def concat_cond(self,concat_latent_image,**kwargs):
        concat_latent_image.mul_(2).add_(1)
        return torch.cat([torch.ones(2,4,3,4,4),concat_latent_image],dim=1)


class ReferenceConditionTest(unittest.TestCase):
    def test_after_normalization_without_repeated_mutation(self):
        model=Base();image=torch.ones(2,16,3,4,4);delta=torch.full((1,20,1,4,4),.5)
        with reference_pose_correction(model,delta):
            for _ in range(2):
                result=model.concat_cond(concat_latent_image=image)
                self.assertTrue(torch.all(result[:,:4]==1.5))
                self.assertTrue(torch.all(result[:,4:]==3.5))
                self.assertTrue(torch.all(image==1))
        self.assertNotIn('concat_cond',model.__dict__)
    def test_restore_after_failure(self):
        model=Base()
        with self.assertRaises(ValueError):
            with reference_pose_correction(model,torch.zeros(1,20,1,8,8)):
                model.concat_cond(concat_latent_image=torch.ones(2,16,3,4,4))
        self.assertNotIn('concat_cond',model.__dict__)
    def test_invalid_residual_and_nested_patch_rejected(self):
        model=Base()
        with self.assertRaises(ValueError):
            with reference_pose_correction(model,torch.zeros(1,16,1,4,4)):pass
        with reference_pose_correction(model,torch.zeros(1,20,1,4,4)):
            with self.assertRaises(ValueError):
                with reference_pose_correction(model,torch.zeros(1,20,1,4,4)):pass


if __name__=='__main__':unittest.main()
