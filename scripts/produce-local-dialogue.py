"""Generate bounded, line-addressed CosyVoice dialogue using configured local voices."""
import json,os,sys,signal
from pathlib import Path
from media_resource_guard import bounded_media

def synthesis_text(line):
 text=line['text']
 overrides=line.get('pronunciationReplacements',[])
 if not isinstance(overrides,list) or len(overrides)>4:raise ValueError('Invalid pronunciation replacements')
 for item in overrides:
  from pypinyin import lazy_pinyin,Style
  source,target=item['source'],item['target']
  if len(source)!=1 or len(target)!=1 or text.count(source)!=1 or not item.get('reason'):
   raise ValueError('Only documented, unique single-character pronunciation replacements supported')
  if lazy_pinyin(source,style=Style.TONE3)!=lazy_pinyin(target,style=Style.TONE3):
   raise ValueError('Pronunciation replacement must match syllable and tone')
  text=text.replace(source,target)
 return text

def execute(d):
 import torch,soundfile as sf
 torch.set_num_threads(2)
 if 'seed' in d:
  import random,numpy as np
  random.seed(d['seed']);np.random.seed(d['seed']);torch.manual_seed(d['seed'])
 home=Path(d['cosyvoiceHome']);sys.path[:0]=[str(home),str(home/'third_party/Matcha-TTS'),str(Path(__file__).resolve().parents[1]/'services/cosyvoice-adapter/python')]
 from wetext_cache import pin_wetext_to_local_cache,require_text_frontend
 pin_wetext_to_local_cache()
 from cosyvoice.cli.cosyvoice import AutoModel
 model=AutoModel(model_dir=d['modelDir']);require_text_frontend(model,allow_degraded=False,opt_out_hint='Repair local frontend before dialogue production')
 out=Path(d['outputDir']);out.mkdir(parents=True,exist_ok=True)
 for line in d['lines']:
  path=out/(line['id']+'.wav')
  if path.exists():raise ValueError('Refusing existing line overwrite')
  voice=d['voices'][line['characterId']]
  spoken_text=synthesis_text(line)
  instruction=line.get('instruction')
  if instruction:
   if not callable(getattr(model,'inference_instruct2',None)):raise ValueError('Configured model does not support instruct2')
   chunks=list(model.inference_instruct2(spoken_text,instruction+'<|endofprompt|>',voice['audio'],stream=False,speed=1.0))
  else:
   chunks=list(model.inference_zero_shot(spoken_text,voice['text'],voice['audio'],stream=False,speed=1.0))
  if not chunks:raise RuntimeError('Empty speech')
  audio=torch.cat([x['tts_speech'].cpu() for x in chunks],dim=1).numpy().T
  partial=path.with_suffix('.partial.wav');sf.write(partial,audio,model.sample_rate);partial.replace(path)
  receipt={**line,'synthesisText':spoken_text,'sampleRate':model.sample_rate,'seconds':len(audio)/model.sample_rate,'voiceReference':voice,'method':'instruct2' if instruction else 'zero_shot','status':'NEEDS_LISTENING_AND_ASR_REVIEW'}
  path.with_suffix('.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2));print(json.dumps({'line':line['id'],'seconds':receipt['seconds']},ensure_ascii=False),flush=True)

if __name__=='__main__':
 p=Path(sys.argv[1]).resolve();d=json.loads(p.read_text())
 if not 1<=len(d['lines'])<=12:raise ValueError('Bounded batches require1–12 lines')
 for l in d['lines']:
  if not l['id'].replace('-','').isalnum() or len(l['text'])>220:raise ValueError('Invalid line')
  synthesis_text(l)
  if 'instruction' in l and (not isinstance(l['instruction'],str) or not 1<=len(l['instruction'])<=300 or '<|' in l['instruction']):raise ValueError('Invalid bounded plain-text instruction')
  if 'instruction' in l and d.get('experimentalInstructionEvaluation') is not True:raise ValueError('Instruction synthesis is evaluation-only; observed spoken-instruction leakage')
 if '--execute' in sys.argv:execute(d)
 else:
  out=Path(d['outputDir']);out.mkdir(parents=True,exist_ok=True)
  os.environ.update(OMP_NUM_THREADS='2',HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1')
  signal.signal(signal.SIGTERM,lambda *_:sys.exit(130))
  with bounded_media([sys.executable,__file__,str(p),'--execute'],out,max_rss_mb=12288,minimum_available_gb=8,max_swap_growth_gb=1,min_free_gb=20,timeout=1800) as(proc,stats):proc.wait()
  (out/'resource-report.json').write_text(json.dumps(stats,indent=2))
