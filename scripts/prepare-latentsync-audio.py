"""Serial audio-feature stage, using existing Whisper-tiny weights only."""
import argparse,json,math,os,sys
from pathlib import Path


def main():
    p=argparse.ArgumentParser()
    for name in ['audio','models','output']:p.add_argument('--'+name,required=True)
    p.add_argument('--execute',action='store_true');a=p.parse_args();out=Path(a.output)
    if out.exists():raise ValueError('Output exists')
    if not a.execute:
        from media_resource_guard import bounded_media
        os.environ.update(HF_HUB_OFFLINE='1',OMP_NUM_THREADS='2')
        out.parent.mkdir(parents=True,exist_ok=True)
        with bounded_media([sys.executable,__file__,*sys.argv[1:],'--execute'],out.parent,max_rss_mb=8192,min_free_gb=20,minimum_available_gb=8,max_swap_growth_gb=1,timeout=300) as(proc,stats):proc.wait()
        out.with_suffix('.resources.json').write_text(json.dumps(stats,indent=2)+'\n');return
    import librosa,numpy as np,mlx.core as mx
    from musetalk_mlx.whisper.whisper_encoder import WhisperEncoder
    from musetalk_mlx.whisper.log_mel import log_mel_spectrogram
    from musetalk_mlx.utils.weights import load_native
    from latentsync_audio_features import encode_hidden_states,feature_windows
    mx.set_memory_limit(4*1024**3);mx.set_cache_limit(128*1024**2)
    wav,_=librosa.load(a.audio,sr=16000)
    if not 0<len(wav)<=64000:raise ValueError('Only <=4 seconds audio allowed')
    encoder=WhisperEncoder();load_native(encoder,Path(a.models)/'whisper_encoder.safetensors');encoder.eval()
    mel=log_mel_spectrogram(mx.array(wav))
    states=encode_hidden_states(encoder,mel);mx.eval(states)
    count=math.ceil(len(wav)*25/16000)
    features=feature_windows(np.array(states.astype(mx.float32)),len(wav),count)
    if not np.isfinite(features).all():raise ValueError('Nonfinite audio features')
    np.save(out,features)
    np.savez(out.with_suffix('.diagnostics.npz'),mel=np.array(mel.astype(mx.float32)),states=np.array(states.astype(mx.float32)))
    out.with_suffix('.json').write_text(json.dumps({'status':'CANDIDATE_FEATURES_REFERENCE_PARITY_PENDING','sourceAudio':a.audio,'samples16kHz':len(wav),'frames25fps':count,'shape':list(features.shape),'hiddenStates':'embedding plus each block output before final layer norm','boundary':'nearest-feature replication','positionalEncodingAdded':False,'audioModified':False},indent=2)+'\n')


if __name__=='__main__':main()
