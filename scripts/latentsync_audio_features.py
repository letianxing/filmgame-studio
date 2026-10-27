"""LatentSync audio contract, distinct from MuseTalk 1.5's HF hidden states.

Collect the embedding and each transformer block output BEFORE final LN.
Window borders repeat the nearest feature. Do not add MuseTalk's positional PE.
The requested frame count is authoritative: never append extra silent frames.
"""
import math


def window_indices(frame, feature_count, fps=25):
    if type(frame) is not int or frame<0 or type(feature_count) is not int or feature_count<1 or fps!=25:
        raise ValueError('LatentSync evaluation requires valid 25fps timestamps')
    center=frame*2
    return [min(feature_count-1,max(0,i)) for i in range(center-4,center+6)]


def encode_hidden_states(encoder,mel):
    """Use the installed MLX encoder's public layers, without editing its source."""
    import mlx.core as mx
    import mlx.nn as nn
    x=nn.gelu(encoder.conv1(mel.transpose(0,2,1)))
    x=nn.gelu(encoder.conv2(x))
    x=x+encoder.embed_positions.weight[None,:x.shape[1],:]
    states=[x]
    for layer in encoder.layers:
        x=layer(x);states.append(x)
    return mx.stack(states,axis=2)


def feature_windows(stacked, audio_samples, frame_count, sr=16000):
    import numpy as np
    if sr!=16000 or type(frame_count) is not int or not 1<=frame_count<=100:
        raise ValueError('Bounded 16kHz feature contract required')
    if stacked.ndim!=4 or stacked.shape[0]!=1 or stacked.shape[2:]!=(5,384):
        raise ValueError('Expected Whisper-tiny pre-LN hidden states')
    duration=audio_samples/sr
    if not 0<duration<=4 or frame_count!=math.ceil(duration*25):
        raise ValueError('Frame count must cover original audio exactly')
    length=math.floor(audio_samples*50/sr)
    if not 1<=length<=stacked.shape[1]:raise ValueError('Incomplete feature sequence')
    states=np.asarray(stacked)[0,:length]
    return np.stack([states[window_indices(i,length)].reshape(50,384) for i in range(frame_count)])
