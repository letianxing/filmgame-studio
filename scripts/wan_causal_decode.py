"""First-party temporal orchestration of installed MLX Wan VAE layers.

Reference contract: Wan-Video/Wan2.2 wan/modules/vae2_1.py (Apache-2.0).
First latent yields one frame; later latents yield four. Existing learned layers
and weights are reused; upstream source and model files remain unchanged.
"""
import mlx.core as mx
import mlx.nn as nn
from pathlib import Path
from mlx_video.models.wan_2.vae import ResidualBlock, Resample


class CausalWanDecoder:
    """Decoder boundary for bounded takes; preserve latents for cheap re-review."""
    def __init__(self, vae, snapshot_path):
        self.vae = vae
        self.snapshot_path = Path(snapshot_path)

    def decode_tiled(self, normalized, tiling_config=None):
        # Temporal streaming bounds activation size for our <=512x512 profile;
        # we deliberately do not delegate to the old independent-tile decoder.
        if self.snapshot_path.exists():
            raise ValueError('Refusing to overwrite saved generation latents')
        mx.eval(normalized)
        mx.save_safetensors(str(self.snapshot_path), {'normalized_latents':normalized})
        return decode_causal(self.vae, normalized)

    def decode(self, normalized):
        return self.decode_tiled(normalized)


def decode_causal(vae, normalized):
    if normalized.ndim != 5 or normalized.shape[0] != 1 or normalized.shape[1] != 16:
        raise ValueError('Expected a single Wan2.1-family latent video')
    if normalized.shape[2] > 17 or normalized.shape[3]*normalized.shape[4] > 64*64:
        raise ValueError('Causal decoder exceeds bounded evaluation profile')
    z = normalized/vae.inv_std.reshape(1,-1,1,1,1)+vae.mean.reshape(1,-1,1,1,1)
    z = vae.conv2(z); mx.eval(z)
    history = {}; residual_history = {}; time_history = {}; outputs = []

    def conv(layer, value):
        key = id(layer); previous = history.get(key)
        result = layer(value, cache_x=previous)
        memory = value if previous is None else mx.concatenate([previous,value],axis=2)
        history[key] = memory[:,:,-2:]
        return result

    def apply(layer, value, first):
        if isinstance(layer, ResidualBlock):
            cache = residual_history.setdefault(id(layer),[None,None])
            return layer(value, feat_cache=cache, feat_idx=[0])
        if isinstance(layer, Resample) and layer.mode == 'upsample3d':
            if not first:
                previous = time_history.get(id(layer))
                before = value
                expanded = layer.time_conv(value, cache_x=previous)
                b,c,t,h,w = before.shape
                paired = expanded.reshape(b,2,c,t,h,w)
                value = mx.stack([paired[:,0],paired[:,1]],axis=3).reshape(b,c,t*2,h,w)
                memory = before if previous is None else mx.concatenate([previous,before],axis=2)
                if memory.shape[2]<2:
                    memory=mx.concatenate([mx.zeros_like(memory),memory],axis=2)
                time_history[id(layer)] = memory[:,:,-2:]
            # Invoke the installed layer's spatial operation without repeating
            # its temporal operation. Restore mode even if inference raises.
            mode = layer.mode
            try:
                layer.mode = 'upsample2d'
                return layer(value)
            finally:
                layer.mode = mode
        return layer(value)

    decoder = vae.decoder
    for index in range(z.shape[2]):
        value = conv(decoder.conv1,z[:,:,index:index+1])
        for layer in [*decoder.middle,*decoder.upsamples]:
            value = apply(layer,value,index==0)
        value = conv(decoder.head[2],nn.silu(decoder.head[0](value)))
        value = mx.clip(value,-1,1)
        expected = 1 if index==0 else 4
        if value.shape[2]!=expected:raise ValueError('Unexpected causal chunk length')
        mx.eval(value,history,residual_history,time_history)
        outputs.append(value);mx.clear_cache()
    result=mx.concatenate(outputs,axis=2)
    if result.shape[2] != 1+4*(z.shape[2]-1):raise ValueError('Temporal alignment failed')
    return result
