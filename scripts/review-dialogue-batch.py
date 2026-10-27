"""Serial CPU ASR. Raw recognition is diagnostic and must never author subtitles."""
import argparse
import json
import sys
from pathlib import Path


def execute(manifest, output, model_name):
    import torch
    import whisper
    torch.set_num_threads(2)
    model_file = Path.home()/'.cache/whisper'/(model_name+'.pt')
    if not model_file.is_file():
        raise ValueError('Install and verify the selected ASR model before review: '+str(model_file))
    model = whisper.load_model(model_name, device='cpu')
    rows = json.loads(Path(manifest).read_text())['lines']
    out = Path(output); out.mkdir(parents=True, exist_ok=True)
    for line in rows:
        if not line.get('audio'):
            continue
        target = out/(line['id']+'.json')
        if target.exists():
            previous = json.loads(target.read_text())
            if previous.get('expected') != line['text'] or Path(previous['audio']).resolve() != Path(line['audio']).resolve() or previous.get('model','small') != model_name:
                raise ValueError('Existing ASR evidence describes a different take or model: '+str(target))
            continue
        result = model.transcribe(line['audio'], language='zh', fp16=False, word_timestamps=True,
                                  temperature=0, condition_on_previous_text=False)
        target.write_text(json.dumps({'lineId':line['id'],'expected':line['text'],
            'canonicalText':line['text'],'audio':line['audio'],'transcript':result['text'],
            'model':model_name,'segments':result['segments'],
            'status':'REQUIRES_COMPARISON_AND_LISTENING',
            'textPolicy':'canonicalText is screenplay text; transcript is raw ASR and must not be used as subtitles'},ensure_ascii=False,indent=2))
        print(json.dumps({'line':line['id'],'scriptText':line['text'],'rawAsrDiagnostic':result['text']},ensure_ascii=False),flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('manifest'); parser.add_argument('output')
    parser.add_argument('--model', choices=['small','medium'], default='small')
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    if args.execute:
        execute(args.manifest,args.output,args.model)
    else:
        from media_resource_guard import bounded_media
        out=Path(args.output); out.mkdir(parents=True,exist_ok=True)
        stats=None
        try:
            with bounded_media([sys.executable,__file__,args.manifest,args.output,'--model',args.model,'--execute'],out,
                max_rss_mb=8192,minimum_available_gb=8,max_swap_growth_gb=1,min_free_gb=2,timeout=1800) as(proc,stats):
                proc.wait()
        finally:
            if stats is not None:
                (out/'resource-report.json').write_text(json.dumps(stats,indent=2))
