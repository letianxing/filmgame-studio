import unittest
from types import SimpleNamespace
from wan_reference_contract import validate_single_reference_conditions


class ReferenceContractTests(unittest.TestCase):
    def bundle(self,refs):return {k:[[None,{'reference_latents':refs}]] for k in ['positive','negative']}
    def test_single_reference_is_not_claimed_as_actor_binding(self):
        r=validate_single_reference_conditions(self.bundle([SimpleNamespace(shape=(1,48,1,28,48))]))
        self.assertFalse(r['independentActorIdentityBinding'])
    def test_multiple_references_cannot_be_silently_discarded(self):
        with self.assertRaisesRegex(ValueError,'exactly one'):
            validate_single_reference_conditions(self.bundle([SimpleNamespace(shape=(1,48,1,28,48))]*2))
    def test_temporal_reference_is_not_an_image(self):
        with self.assertRaises(ValueError):validate_single_reference_conditions(self.bundle([SimpleNamespace(shape=(1,48,5,28,48))]))


if __name__=='__main__':unittest.main()
