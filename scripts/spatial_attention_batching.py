"""Bound independent spatial-attention batch work without splitting time tokens."""
from contextlib import contextmanager


def batch_sliced_attention(original,query,key,value,*,batch_size=1,minimum_tokens=1024,**kwargs):
    # Temporal attention has short token length and must retain its full window.
    # Handle only the model's unmasked, four-dimensional independent batches.
    if (query.ndim!=4 or key.ndim!=4 or value.ndim!=4 or
            query.shape[-2]<minimum_tokens or query.shape[0]<=batch_size or
            key.shape[0]!=query.shape[0] or value.shape[0]!=query.shape[0] or
            kwargs.get('attn_mask') is not None or kwargs.get('dropout_p',0)!=0):
        return original(query,key,value,**kwargs)
    import torch
    if batch_size<1:raise ValueError('Positive batch slice size required')
    return torch.cat([original(query[i:i+batch_size],key[i:i+batch_size],value[i:i+batch_size],**kwargs)
                      for i in range(0,query.shape[0],batch_size)],dim=0)


@contextmanager
def spatial_attention_batches(batch_size=1):
    import torch.nn.functional as functional
    original=functional.scaled_dot_product_attention
    counts={'slicedCalls':0}
    def forward(query,key,value,attn_mask=None,dropout_p=0,is_causal=False,**kwargs):
        if query.ndim==4 and query.shape[-2]>=1024 and query.shape[0]>batch_size and attn_mask is None:
            counts['slicedCalls']+=1
        return batch_sliced_attention(original,query,key,value,batch_size=batch_size,
            attn_mask=attn_mask,dropout_p=dropout_p,is_causal=is_causal,**kwargs)
    functional.scaled_dot_product_attention=forward
    try:yield counts
    finally:functional.scaled_dot_product_attention=original
