import copy,json,struct,unittest
from pathlib import Path
from importlib.machinery import SourceFileLoader
module=SourceFileLoader('adapter_download',str(Path(__file__).with_name('download-multianimate-adapter.py'))).load_module()


class PlanTest(unittest.TestCase):
    def setUp(self):
        self.data={'status':'ALL_HEADERS_INSPECTED','revision':'a'*40,'selectedBytes':16,'shards':[{'path':'weights','headerBytes':100,'selected':[{'name':'a','dtype':'F32','shape':[2],'data_offsets':[0,8]},{'name':'b','dtype':'F32','shape':[2],'data_offsets':[16,24]}]}]}
    def test_skips_unselected_bytes_and_reindexes(self):
        header,segments,size=module.plan(self.data);n=struct.unpack('<Q',header[:8])[0];meta=json.loads(header[8:8+n]);self.assertEqual(meta['b']['data_offsets'],[8,16]);self.assertEqual(segments[1]['sourceStart'],124);self.assertEqual(size,16)
    def test_adjacent_ranges_coalesce(self):
        self.data['shards'][0]['selected'][1]['data_offsets']=[8,16]
        self.assertEqual(len(module.plan(self.data)[1]),1)
    def test_bad_shape_duplicate_and_unpinned_rejected(self):
        for mutation in ['shape','duplicate','revision']:
            d=copy.deepcopy(self.data)
            if mutation=='shape':d['shards'][0]['selected'][0]['shape']=[3]
            elif mutation=='duplicate':d['shards'][0]['selected'][1]['name']='a'
            else:d['revision']='main'
            with self.assertRaises(ValueError):module.plan(d)


if __name__=='__main__':unittest.main()
