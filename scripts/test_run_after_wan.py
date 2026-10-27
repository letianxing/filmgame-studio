import copy
import unittest
from importlib.machinery import SourceFileLoader
from pathlib import Path

module=SourceFileLoader('after_wan',str(Path(__file__).with_name('run-after-wan.py'))).load_module()


class DependencyGateTest(unittest.TestCase):
    def setUp(self):
        self.state={'status':'ALL_STAGES_COMPLETE_REVIEW_REQUIRED','stages':[
            {'stage':s,'status':'COMPLETE','returncode':0} for s in ['text','visual','sample','decode']]}
    def test_all_stages_required(self):
        self.assertTrue(module.completed(self.state))
        for count in range(4):
            state=copy.deepcopy(self.state);state['stages']=state['stages'][:count]
            self.assertFalse(module.completed(state))
    def test_stale_success_label_does_not_hide_failure(self):
        for index in range(4):
            state=copy.deepcopy(self.state);state['stages'][index]['returncode']=1
            self.assertFalse(module.completed(state))
    def test_running_and_failed_are_not_success(self):
        for status in ['RUNNING','STOPPED_NO_AUTOMATIC_RETRY']:
            self.state['status']=status;self.assertFalse(module.completed(self.state))


if __name__=='__main__':unittest.main()
