import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('dialogue',Path(__file__).with_name('produce-local-dialogue.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class PronunciationTests(unittest.TestCase):
 def line(self,target='香',text='龙骧虎视'):
  return {'text':text,'pronunciationReplacements':[{'source':'骧','target':target,'reason':'xiang1 repair'}]}
 def test_preserves_authoritative_text(self):
  line=self.line()
  self.assertEqual(module.synthesis_text(line),'龙香虎视')
  self.assertEqual(line['text'],'龙骧虎视')
 def test_rejects_changed_tone_or_initial(self):
  for target in ['想','央']:
   with self.assertRaises(ValueError):module.synthesis_text(self.line(target))
 def test_rejects_ambiguous_or_missing_source(self):
  for text in ['骧骧','虎视']:
   with self.assertRaises(ValueError):module.synthesis_text(self.line(text=text))
 def test_unchanged_without_override(self):
  self.assertEqual(module.synthesis_text({'text':'龙骧虎视'}),'龙骧虎视')

if __name__=='__main__':unittest.main()
