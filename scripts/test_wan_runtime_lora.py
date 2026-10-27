import tempfile,unittest
from pathlib import Path
import mlx.core as mx
import mlx.nn as nn
from wan_runtime_lora import attach_runtime_lora

class Tiny(nn.Module):
    def __init__(self):
        super().__init__();self.proj=nn.QuantizedLinear(64,64,bits=4,group_size=64)
    def __call__(self,x):return self.proj(x)

class RuntimeLoRATests(unittest.TestCase):
    def test_preserves_quantized_base_and_applies_delta(self):
        model=Tiny();base=model.proj;x=mx.ones((1,64));a=mx.full((4,64),.01);b=mx.full((64,4),.02)
        expected=base(x)+(x@a.astype(mx.bfloat16).T@b.astype(mx.bfloat16).T)
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'lora.safetensors';mx.save_safetensors(str(p),{'proj.lora_A.weight':a,'proj.lora_B.weight':b})
            self.assertEqual(attach_runtime_lora(model,p),1)
        self.assertIs(model.proj.linear,base)
        self.assertEqual(base.bits,4)
        self.assertTrue(mx.allclose(model(x),expected,atol=1e-5).item())
    def test_unknown_target_fails_instead_of_silently_skipping(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'lora.safetensors';mx.save_safetensors(str(p),{'wrong.lora_A.weight':mx.ones((4,64)),'wrong.lora_B.weight':mx.ones((64,4))})
            with self.assertRaises(ValueError):attach_runtime_lora(Tiny(),p)

if __name__=='__main__':unittest.main()
