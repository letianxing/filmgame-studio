"""Replace one changed line while preserving all other balanced PCM bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import wave
import numpy as np
import soundfile as sf


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('previous',type=Path);p.add_argument('current',type=Path);p.add_argument('output',type=Path)
    a=p.parse_args();old=json.loads((a.previous/'timeline.json').read_text());new=json.loads((a.current/'timeline.json').read_text())
    assert old['sampleRate']==new['sampleRate'] and len(old['lines'])==len(new['lines'])
    changed=[]
    for before,after in zip(old['lines'],new['lines']):
        assert before['lineId']==after['lineId'] and before['characterId']==after['characterId']
        if before['sourceSha256']!=after['sourceSha256']:changed.append((before,after))
        else:assert before['text']==after['text'] and before['endSample']-before['startSample']==after['endSample']-after['startSample']
    assert len(changed)==1,'Only one replacement supported'
    before,after=changed[0];assert before['startSample']==after['startSample']
    plan=json.loads((a.previous/'gain-plan.json').read_text());gain=plan['characters'][after['characterId']]['appliedGainDb']
    source=Path(after['source']);assert hashlib.sha256(source.read_bytes()).hexdigest()==after['sourceSha256']
    samples,rate=sf.read(source);assert samples.ndim==1 and rate==new['sampleRate']
    samples=samples*10**(gain/20);assert np.isfinite(samples).all() and np.max(np.abs(samples))<1
    assert len(samples)==after['endSample']-after['startSample']
    a.output.mkdir(parents=True,exist_ok=False)
    sf.write(a.output/'replacement.wav',samples,rate,subtype='PCM_24')
    with wave.open(str(a.previous/'dialogue.wav')) as original, wave.open(str(a.output/'replacement.wav')) as replacement:
        params=original.getparams();assert params.sampwidth==3 and params.nchannels==1
        assert original.getnframes()==old['samples'] and params.framerate==rate
        with wave.open(str(a.output/'dialogue.partial.wav'),'wb') as target:
            target.setparams(params)
            def copy_frames(stream,count):
                while count:
                    n=min(count,rate);block=stream.readframes(n);assert len(block)==n*3
                    target.writeframesraw(block);count-=n
            copy_frames(original,before['startSample']);copy_frames(replacement,len(samples))
            original.setpos(before['endSample']);copy_frames(original,old['samples']-before['endSample'])
    checked=0
    with wave.open(str(a.previous/'dialogue.wav')) as original,wave.open(str(a.output/'dialogue.partial.wav')) as result:
        assert result.getnframes()==new['samples']
        for x,y in zip(old['lines'],new['lines']):
            if x['lineId']==after['lineId']:continue
            original.setpos(x['startSample']);result.setpos(y['startSample']);count=x['endSample']-x['startSample']
            assert original.readframes(count)==result.readframes(count);checked+=1
    (a.output/'dialogue.partial.wav').replace(a.output/'dialogue.wav')
    for key in ['peakAmplitude','clippedSamples']:new.pop(key,None)
    new.update(status='BALANCED_CANDIDATE_NOT_FINAL_MIX',sourceTimeline=str(a.current/'timeline.json'),gainPlan='gain-plan.json')
    plan.update(sourcePlan=str(a.previous/'gain-plan.json'),revision='Preserve prior balanced PCM except one regenerated line; reuse its character gain. New loudness measurement required.')
    verification=dict(status='PCM_VERIFIED_NOT_LISTENING_APPROVAL',unchangedLinesByteExact=checked,replacedLine=after['lineId'],replacementGainDb=gain,samples=new['samples'],seconds=new['seconds'])
    for name,data in [('timeline.json',new),('gain-plan.json',plan),('sample-verification.json',verification)]:
        (a.output/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    shutil.copyfile(a.current/'canonical-dialogue-draft.srt',a.output/'canonical-dialogue-draft.srt')
    print(json.dumps(verification))


if __name__=='__main__':main()
