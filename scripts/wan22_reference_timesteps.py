"""Match VideoX-Fun's prepended reference tokens with prepended timesteps.

Comfy's repeat_e expands frame-level modulation to patch tokens. With one
reference frame, both sequences must contain T+1 frames before that expansion.
"""
from contextlib import contextmanager
from types import MethodType


def prepend_reference_timestep(frame_steps):
    import torch
    if frame_steps.ndim!=2 or frame_steps.shape[1]<1:
        raise ValueError('Expected batched frame timesteps')
    # Upstream pads its full-reference prefix with the final video timestep.
    return torch.cat([frame_steps[:,-1:],frame_steps],dim=1)


@contextmanager
def align_reference_timesteps(model):
    cfg=model.model_config.unet_config
    if cfg.get('in_dim')!=148 or cfg.get('out_dim')!=48:
        raise ValueError('Adapter is scoped to Wan2.2 Fun 5B Control')
    original=model.process_timestep;counts={'correctedCalls':0}
    def process(self,timestep,x,denoise_mask=None,**kwargs):
        result=original(timestep,x=x,denoise_mask=denoise_mask,**kwargs)
        reference=kwargs.get('reference_latent')
        if denoise_mask is None or reference is None:return result
        if self.diffusion_model.ref_conv is None:raise ValueError('Reference convolution missing')
        if reference.ndim!=4 or reference.shape[-2:]!=x.shape[-2:]:raise ValueError('Reference grid differs; frame-prefix adapter cannot apply')
        if result.ndim!=2 or result.shape[1]!=x.shape[2]:raise ValueError('Unexpected video timestep layout')
        counts['correctedCalls']+=1
        return prepend_reference_timestep(result)
    model.process_timestep=MethodType(process,model)
    try:yield counts
    finally:model.process_timestep=original
