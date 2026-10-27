"""Attach pinned upstream LoRA wrappers without expanding quantized base weights."""
from pathlib import Path
import mlx.core as mx
import mlx.nn as nn
from mlx.utils import tree_unflatten
from mlx_video.lora import LoRALinear, load_lora_weights
from mlx_video.lora.apply import _normalize_wan_lora_key

def attach_runtime_lora(model, path):
    modules=dict(model.named_modules())
    keys={name+'.weight' for name,module in modules.items()
          if isinstance(module,(nn.Linear,nn.QuantizedLinear))}
    weights=load_lora_weights(Path(path))
    replacements=[];seen=set()
    for name,lora in weights.items():
        target_name=_normalize_wan_lora_key(name,keys)
        if target_name.endswith('.weight'):target_name=target_name[:-7]
        target=modules.get(target_name)
        if not isinstance(target,(nn.Linear,nn.QuantizedLinear)) or target_name in seen:
            raise ValueError('Unmatched or duplicated LoRA target: '+name)
        input_dim=target.weight.shape[1]*(32//target.bits) if isinstance(target,nn.QuantizedLinear) else target.weight.shape[1]
        output_dim=target.weight.shape[0]
        if lora.lora_A.shape[1]!=input_dim or lora.lora_B.shape[0]!=output_dim:
            raise ValueError('LoRA shape mismatch: '+name)
        if not 1<=lora.rank<=256:raise ValueError('Unsupported LoRA rank')
        lora.lora_A=lora.lora_A.astype(mx.bfloat16)
        lora.lora_B=lora.lora_B.astype(mx.bfloat16)
        mx.eval(lora.lora_A,lora.lora_B)
        replacements.append((target_name,LoRALinear(target,[(lora,1.0)])))
        seen.add(target_name)
    if not replacements:raise ValueError('No LoRA modules applied')
    model.update_modules(tree_unflatten(replacements))
    mx.clear_cache()
    return len(replacements)
