import gc
import unittest
import weakref
from weak_model_call import weak_model_call

class Model:
    def __call__(self, value, *, scale=1):
        return value*scale

class WeakModelCallTests(unittest.TestCase):
    def test_preserves_forward_arguments(self):
        model=Model();call=weak_model_call(model)
        self.assertEqual(call(7,scale=3),21)
    def test_cached_call_does_not_retain_model_after_owner_release(self):
        model=Model();ref=weakref.ref(model)
        model._compiled=weak_model_call(model)
        cached_call=model._compiled
        del model;gc.collect()
        self.assertIsNone(ref())
        with self.assertRaisesRegex(RuntimeError,'released'):
            cached_call(7)

if __name__=='__main__':unittest.main()
