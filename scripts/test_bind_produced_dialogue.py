import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('bind_dialogue', Path(__file__).with_name('bind-produced-dialogue.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class BindingTests(unittest.TestCase):
    def line(self, **patch):
        return dict(id='line-1', characterId='kongming', sceneId='scene-1', text='然。', audio=None, **patch)

    def test_rescan_preserves_selected_take_and_review(self):
        row = self.line(audioReview='HOLD', asrEvidence='review.json')
        row['audio'] = 'selected.wav'
        document = {'lines':[row]}
        module.bind_dialogue(document, {('kongming','scene-1','然。'):[(Path('older.wav'), {'seconds':1})]})
        self.assertEqual(row['audio'], 'selected.wav')
        self.assertEqual(row['audioReview'], 'HOLD')
        self.assertEqual(row['asrEvidence'], 'review.json')

    def test_ambiguous_takes_are_not_chosen_by_filesystem_order(self):
        row = self.line()
        result = module.bind_dialogue({'lines':[row]}, {('kongming','scene-1','然。'):[(Path('a.wav'), {'seconds':1}), (Path('b.wav'), {'seconds':2})]})
        self.assertIsNone(row['audio'])
        self.assertEqual(len(result['ambiguous']), 1)

    def test_single_exact_take_is_bound_but_not_approved(self):
        row = self.line()
        result = module.bind_dialogue({'lines':[row]}, {('kongming','scene-1','然。'):[(Path('new.wav'), {'seconds':1})]})
        self.assertEqual(result['bound'], 1)
        self.assertEqual(row['audioReview'], 'GENERATED_NOT_REVIEWED')

if __name__ == '__main__':
    unittest.main()
