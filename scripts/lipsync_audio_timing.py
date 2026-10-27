"""Experimental fixed-time Whisper windows; preserves the 25 fps baseline.

The model consumes ten 50 Hz feature steps. Changing video FPS changes frame
timestamps, not the duration or left context of that window. No upstream files
are modified. This corrects feature indexing, not a claim of perceptual sync.
"""
from contextlib import contextmanager
import math


def feature_indices(frame, fps):
    if type(frame) is not int or frame < 0 or not math.isfinite(fps) or not 1 <= fps <= 30:
        raise ValueError('Invalid frame timestamp')
    start = math.floor(frame * 50 / fps) - 4
    return list(range(start, start + 10))


def timestamp_chunks(stacked, librosa_length, fps=25, audio_fps=50,
                     sr=16000, pad_left=2, pad_right=2, *, backend=None):
    if (audio_fps, sr, pad_left, pad_right) != (50, 16000, 2, 2):
        raise ValueError('Unsupported audio feature contract')
    feature_indices(0, fps)
    if backend is None:
        import mlx.core as backend
    actual = min(stacked.shape[1], math.floor(librosa_length * 50 / sr))
    count = math.floor(librosa_length * fps / sr)
    if actual <= 0 or count <= 0 or stacked.ndim != 4 or stacked.shape[0] != 1:
        raise ValueError('Insufficient or invalid audio features')
    windows = []
    for frame in range(count):
        indexes = feature_indices(frame, fps)
        pieces = [stacked[:, i:i+1] if 0 <= i < actual else
                  backend.zeros_like(stacked[:, :1]) for i in indexes]
        windows.append(backend.concatenate(pieces, axis=1))
    result = backend.concatenate(windows, axis=0)
    return result.reshape(count, 10 * stacked.shape[2], stacked.shape[3])


@contextmanager
def audio_timing_adapter(module):
    """Scope the API substitution to serial audio encoding in our worker."""
    original = module.get_whisper_chunk
    module.get_whisper_chunk = timestamp_chunks
    try:
        yield
    finally:
        module.get_whisper_chunk = original
