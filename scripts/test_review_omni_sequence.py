import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('sequence', Path(__file__).with_name('review-omni-sequence.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CoverageTests(unittest.TestCase):
    def test_fractional_tail_and_no_gap(self):
        plan = module.windows(11.192)
        self.assertEqual(len(plan), 3)
        self.assertAlmostEqual(sum(plan[-1]), 11.192)
        for previous, current in zip(plan, plan[1:]):
            self.assertLessEqual(current[0], sum(previous))

    def test_exact_end_has_no_redundant_window(self):
        self.assertEqual(module.windows(6), [(0, 6)])
        self.assertEqual(module.windows(11), [(0, 6), (5, 6)])

    def test_invalid_and_unbounded_inputs(self):
        for duration in (0, -1, float('nan'), float('inf'), 121):
            with self.assertRaises(ValueError):
                module.windows(duration)
        with self.assertRaises(ValueError):
            module.windows(10, 6, 6)


if __name__ == '__main__':
    unittest.main()
