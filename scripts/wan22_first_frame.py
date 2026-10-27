"""Explicit Wan2.2 inpaint anchor in raw VAE latent coordinates.

Conditioning alone does not freeze the initial latent. Comfy's noise_mask is
also forwarded as denoise_mask to WAN22's per-frame timestep processing.
"""
def anchor_first_frame(latent,reference):
    import torch
    samples=latent['samples']
    if samples.ndim!=5 or samples.shape[1]!=48 or reference.shape!=(samples.shape[0],48,1,*samples.shape[-2:]):
        raise ValueError('Expected matching Wan2.2 48-channel first-frame latent')
    if not torch.isfinite(reference).all():raise ValueError('Nonfinite first-frame latent')
    result=dict(latent);result['samples']=samples.clone()
    result['samples'][:,:,:1]=reference.to(device=samples.device,dtype=samples.dtype)
    mask=torch.ones((samples.shape[0],1,*samples.shape[2:]),device=samples.device,dtype=samples.dtype)
    mask[:,:,:1]=0
    result['noise_mask']=mask
    return result
