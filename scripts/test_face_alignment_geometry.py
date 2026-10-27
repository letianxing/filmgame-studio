import unittest
import numpy as np
from face_alignment_geometry import similarity_transform,transform_points


class GeometryTests(unittest.TestCase):
    def test_known_transform_and_inverse(self):
        source=np.array([[12,20],[45,21],[29,40]],dtype=float)
        expected=np.array([[1.8,-.4,10],[.4,1.8,-7]])
        target=transform_points(source,expected)
        actual=similarity_transform(source,target)
        np.testing.assert_allclose(actual,expected,atol=1e-10)
        inverse=np.linalg.inv(np.vstack([actual,[0,0,1]]))[:2]
        np.testing.assert_allclose(transform_points(target,inverse),source,atol=1e-10)

    def test_degenerate_or_nonfinite_rejected(self):
        for source in [np.zeros((3,2)),np.full((3,2),np.nan)]:
            with self.assertRaises(ValueError):similarity_transform(source,[[0,0],[2,0],[1,1]])


if __name__=='__main__':unittest.main()
