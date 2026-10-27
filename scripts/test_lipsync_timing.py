import importlib.util
from pathlib import Path
import unittest
import tempfile
spec=importlib.util.spec_from_file_location('lipsync',Path(__file__).with_name('evaluate-local-lipsync.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class TimingTests(unittest.TestCase):
 def test_fractional_final_frame_is_kept(self):self.assertEqual(m.speech_frame_budget(3.11,16,57),50)
 def test_too_short_real_video_is_rejected(self):
  with self.assertRaises(ValueError):m.speech_frame_budget(3.11,16,49)
 def test_unsupported_rate_does_not_silently_round(self):
  with self.assertRaises(ValueError):m.speech_frame_budget(3,23.976,80)
 def test_exact_frame_budget_has_no_extra_frame(self):self.assertEqual(m.speech_frame_budget(3,16,48),48)
 def test_roi_requires_existing_review_and_valid_bounds(self):
  with tempfile.TemporaryDirectory() as temp:
   review=Path(temp)/'review.json';review.write_text('{}')
   request={'video':'video','audio':'audio','modelDir':'model','output':str(Path(temp)/'out.mp4'),'maxSeconds':2,'faceDetectionRegion':[.45,0,.73,.45],'singleSubjectVisualReview':str(review)}
   m.validate_request(request)
   request['faceDetectionRegion']=[.8,0,.3,1]
   with self.assertRaises(ValueError):m.validate_request(request)
   request['faceDetectionRegion']=[.45,0,.73,.45];review.unlink()
   with self.assertRaises(ValueError):m.validate_request(request)
if __name__=='__main__':unittest.main()
