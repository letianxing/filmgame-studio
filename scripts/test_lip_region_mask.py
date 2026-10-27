import unittest
import numpy as np
from lip_region_mask import lip_mask, OUTER_LIPS

class LipMaskTests(unittest.TestCase):
    def test_jaw_cheeks_and_upper_face_have_no_reconstruction_support(self):
        points=np.zeros((468,2),np.float32)
        for i,k in enumerate(OUTER_LIPS):
            a=i*2*np.pi/len(OUTER_LIPS)
            points[k]=(60+15*np.cos(a),65+3*np.sin(a))
        mask=lip_mask(points,(10,10,110,110))[:,:,0]
        self.assertGreater(mask.max(),.9)
        self.assertGreaterEqual(mask.min(),0)
        self.assertLessEqual(mask.max(),1)
        self.assertFalse(mask[:50].any())
        self.assertFalse(mask[70:].any())
        self.assertFalse(mask[:,:30].any())
        self.assertFalse(mask[:,75:].any())
        original=np.full((100,100,3),87,np.uint8)
        generated=np.full_like(original,220)
        mixed=(generated*mask[:,:,None]+original*(1-mask[:,:,None])).astype(np.uint8)
        np.testing.assert_array_equal(mixed[mask==0],original[mask==0])

    def test_invalid_geometry_is_rejected(self):
        with self.assertRaises(ValueError):lip_mask(np.full((468,2),np.nan),(0,0,100,100))

    def test_upper_lip_protection_excludes_moustache_pixels(self):
        points=np.zeros((468,2),np.float32)
        for i,k in enumerate(OUTER_LIPS):
            angle=i*2*np.pi/len(OUTER_LIPS)
            points[k]=(60+15*np.cos(angle),65+3*np.sin(angle))
        points[13]=(60,65)
        mask=lip_mask(points,(10,10,110,110),preserve_upper_lip=True)[:,:,0]
        self.assertFalse(mask[:55].any())
        self.assertGreater(mask[55:].max(),0)

if __name__=='__main__':unittest.main()
