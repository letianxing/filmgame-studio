"""Bounded original voice design; no actor reference or cloud fallback."""
import json,os,sys,signal
from pathlib import Path
from media_resource_guard import bounded_media

def execute(d):
 import mlx.core as mx
 from mlx_audio.tts.utils import load_model
 from mlx_audio.audio_io import write
 mx.set_memory_limit(8*1024**3);mx.set_cache_limit(256*1024**2);mx.random.seed(d.get('seed',208))
 model=load_model(d['modelDir']);out=Path(d['outputDir']);out.mkdir(exist_ok=True,parents=True)
 for voice in d['voices']:
  path=out/(voice['id']+'.wav')
  if path.exists():raise ValueError('Refusing overwrite')
  max_seconds=d.get('maxSampleSeconds',40)
  results=list(model.generate_voice_design(text=voice['text'],instruct=voice['description'],language='Chinese',max_tokens=min(750,round(max_seconds*12.5)),temperature=.7))
  if not results:raise ValueError('No speech generated')
  audio=mx.concatenate([r.audio.reshape(-1) for r in results]);mx.eval(audio)
  sr=results[0].sample_rate
  if len(audio)/sr>max_seconds:raise ValueError('Unexpected long voice sample')
  partial=path.with_suffix('.partial.wav');write(str(partial),audio,sr);partial.replace(path)
  path.with_suffix('.json').write_text(json.dumps({**voice,'sampleRate':sr,'seconds':len(audio)/sr,'status':'POSSIBLE_TRUNCATION_CHECK_REQUIRED' if len(audio)/sr>=max_seconds-.2 else 'CANDIDATE_REQUIRES_LISTENING','maxSampleSeconds':max_seconds,'generationTokenBudget':min(750,round(max_seconds*12.5)),'model':'Qwen3-TTS-1.7B-VoiceDesign-4bit'},ensure_ascii=False,indent=2));print(str(path),flush=True)

if __name__=='__main__':
 p=Path(sys.argv[1]).resolve();d=json.loads(p.read_text())
 if type(d.get('maxSampleSeconds',40)) is not int or not 1<=d.get('maxSampleSeconds',40)<=60:raise ValueError('Invalid bounded sample duration')
 if not 1<=len(d['voices'])<=10:raise ValueError('Invalid batch size')
 for v in d['voices']:
  if not v['id'].replace('-','').isalnum() or len(v['text'])>120:raise ValueError('Invalid sample')
 if '--execute' in sys.argv:execute(d)
 else:
  os.environ.update(HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',OMP_NUM_THREADS='2')
  out=Path(d['outputDir']);out.mkdir(parents=True,exist_ok=True);signal.signal(signal.SIGTERM,lambda *_:sys.exit(130))
  with bounded_media([sys.executable,__file__,str(p),'--execute'],out,max_rss_mb=12288,minimum_available_gb=8,max_swap_growth_gb=1,min_free_gb=20,timeout=900) as(proc,stats):proc.wait()
  (out/'resource-report.json').write_text(json.dumps(stats,indent=2))
