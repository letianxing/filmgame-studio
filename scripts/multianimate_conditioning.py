"""First-party adapter for positive-only MultiAnimate token conditioning.

Uses Comfy's first-block replacement boundary; no upstream source mutation.
The caller must separately validate base weights, LoRA and encoded conditions.
"""
import torch
import contextlib
import types


def sampling_sigmas(steps=50,shift=5.0):
    """Upstream extra-one-step FlowMatch schedule, including terminal zero."""
    if type(steps) is not int or not 1<=steps<=100 or not 0<float(shift)<100:
        raise ValueError('Unbounded sampling schedule')
    values=torch.linspace(1.,0.,steps+1,dtype=torch.float32)[:-1]
    values=shift*values/(1+(shift-1)*values)
    return torch.cat([values,torch.zeros(1,dtype=torch.float32)])


@contextlib.contextmanager
def reference_pose_correction(base_model, correction):
    """Add the 20-channel reference-pose residual after VAE normalization.

    Both CFG branches receive this residual, matching MultiAnimate's image y.
    Scope the method replacement to one isolated worker and restore on exit.
    """
    if correction.ndim!=5 or correction.shape[:3]!=(1,20,1) or not torch.isfinite(correction).all():
        raise ValueError('Expected finite [1,20,1,H,W] reference-pose residual')
    if getattr(base_model,'_multianimate_reference_active',False):raise ValueError('Reference residual already installed')
    absent=object();previous=base_model.__dict__.get('concat_cond',absent);original=base_model.concat_cond
    def corrected(self,**kwargs):
        # The installed base may normalize image channels in-place.
        if kwargs.get('concat_latent_image') is not None:
            kwargs={**kwargs,'concat_latent_image':kwargs['concat_latent_image'].clone()}
        value=original(**kwargs)
        if value is None or value.ndim!=5 or value.shape[1]!=20 or value.shape[-2:]!=correction.shape[-2:]:
            raise ValueError('Reference residual does not match assembled image condition')
        return value+correction.to(device=value.device,dtype=value.dtype)
    base_model._multianimate_reference_active=True
    base_model.concat_cond=types.MethodType(corrected,base_model)
    try:yield
    finally:
        if previous is absent:delattr(base_model,'concat_cond')
        else:base_model.concat_cond=previous
        delattr(base_model,'_multianimate_reference_active')


def first_block_condition(condition):
    if condition.ndim != 3 or condition.shape[0] != 1 or condition.shape[2] != 5120:
        raise ValueError('Expected one Wan 14B condition with width 5120')
    if not torch.isfinite(condition).all():
        raise ValueError('Non-finite identity/pose condition')

    def replace(arguments, callbacks):
        options=arguments['transformer_options']
        if options.get('block_index') != 0:
            raise ValueError('Condition must be injected once, before block zero')
        image=arguments['img'];flags=options.get('cond_or_uncond')
        if not flags or any(type(x) is not int or x not in (0,1) for x in flags):
            raise ValueError('Explicit Comfy positive/negative batch labels required')
        if image.ndim != 3 or image.shape[1:] != condition.shape[1:] or image.shape[0] % len(flags):
            raise ValueError('Condition token grid or CFG batch mismatch')
        count=image.shape[0]//len(flags)
        gate=torch.tensor([1 if flag==0 else 0 for flag in flags],device=image.device,dtype=image.dtype)
        gate=gate.repeat_interleave(count).reshape(-1,1,1)
        conditioned=image+gate*condition.to(device=image.device,dtype=image.dtype)
        return callbacks['original_block']({**arguments,'img':conditioned})

    return replace
