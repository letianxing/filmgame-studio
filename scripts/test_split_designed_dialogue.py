import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('split_dialogue',Path(__file__).with_name('split-designed-dialogue.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class BoundaryTests(unittest.TestCase):
    def test_separate_words_allow_precise_line_boundaries(self):
        result=module.align_boundaries([{'id':'a','text':'幸会。'},{'id':'b','text':'先生。'}],[{'word':'幸会'},{'word':'先生'}],list)
        self.assertEqual([(x['firstWord'],x['lastWord']) for x in result],[(0,0),(1,1)])
    def test_word_spanning_lines_is_rejected(self):
        with self.assertRaises(ValueError):module.align_boundaries([{'id':'a','text':'幸会'},{'id':'b','text':'先生'}],[{'word':'幸会先生'}],list)
    def test_missing_final_word_is_rejected(self):
        with self.assertRaises(ValueError):module.align_boundaries([{'id':'a','text':'幸会先生'}],[{'word':'幸会'}],list)
if __name__=='__main__':unittest.main()

class SilenceTests(unittest.TestCase):
    def test_early_asr_end_does_not_cut_spoken_tail(self):
        import numpy as np
        audio=np.zeros(2000);audio[:800]=.1;audio[1200:]=.1
        cut=module.silence_cut(audio,1000,{'start':.24,'end':.6},{'start':.6,'end':1.44})
        self.assertGreater(cut,.8);self.assertLess(cut,1.2)
    def test_continuous_speech_is_not_cut_blindly(self):
        import numpy as np
        with self.assertRaises(ValueError):module.silence_cut(np.ones(2000)*.1,1000,{'start':.2,'end':.6},{'start':.6,'end':1.4})
