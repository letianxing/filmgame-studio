"""Split an exact-text voice-design recording using ASR word boundaries.

The alignment is a proposed edit, not pronunciation, acting or cast approval.
Ambiguous or missing boundaries fail closed; original recordings are preserved.
"""
import argparse
import difflib
import json
import re
from pathlib import Path


def chinese(text):
    return ''.join(re.findall(r'[\u3400-\u9fff]', text))


def align_boundaries(lines, recognized_words, phonetics):
    expected = ''.join(chinese(line['text']) for line in lines)
    heard = ''
    owners = []
    for index, word in enumerate(recognized_words):
        chars = chinese(word['word'])
        heard += chars
        owners.extend([index]*len(chars))
    matcher = difflib.SequenceMatcher(None, phonetics(expected), phonetics(heard), autojunk=False)
    mapping = {}
    for op, i, j, k, l in matcher.get_opcodes():
        if op == 'equal' or (op == 'replace' and j-i == l-k):
            mapping.update((i+n, k+n) for n in range(j-i))
    result = []
    cursor = 0
    previous_end_word = -1
    for line in lines:
        size = len(chinese(line['text']))
        if not size or cursor not in mapping or cursor+size-1 not in mapping:
            raise ValueError('Missing ASR boundary for '+line['id'])
        first = owners[mapping[cursor]]
        last = owners[mapping[cursor+size-1]]
        if first <= previous_end_word or last < first:
            raise ValueError('ASR word crosses line boundary: '+line['id'])
        result.append({'line':line, 'firstWord':first, 'lastWord':last})
        previous_end_word = last
        cursor += size
    return result


def silence_cut(audio, rate, left_word, right_word):
    """Word timestamps locate a search region; only a real quiet gap permits a cut."""
    import numpy as np
    mono = np.asarray(audio)
    if mono.ndim == 2:
        mono = np.max(np.abs(mono), axis=1)
    # ASR word onsets can drift by a few hundred ms; include adjacent speech
    # so a long punctuation pause is not mistaken for a region with no words.
    estimate = (left_word['end']+right_word['start'])/2
    lo = max(0, left_word['start']-.3, estimate-1.5)
    hi = min(len(mono)/rate, right_word['end']+.3, estimate+1.5)
    window = max(1, round(rate*.01))
    start, stop = round(lo*rate), round(hi*rate)
    if stop-start < window*6:
        raise ValueError('No room for a safe sentence cut')
    values = [(i, float(np.sqrt(np.mean(mono[i:i+window]**2)))) for i in range(start,stop-window+1,window)]
    threshold = max(.0002, max(value for _,value in values)*.02)
    runs, run = [], []
    for position, value in values:
        if value <= threshold:
            run.append(position)
        else:
            if len(run)>=6:runs.append(run)
            run=[]
    if len(run)>=6:runs.append(run)
    # Reject apparent gaps that are actually leading silence before the left word.
    # ASR may allocate a word across silence and then place its real onset later.
    runs = [run for run in runs if
        sum(value > threshold*3 for position,value in values if position < run[0]) >= 3 and
        sum(value > threshold*3 for position,value in values if position > run[-1]) >= 3]
    if not runs:
        raise ValueError('No >=60ms quiet gap at line boundary; retain full source for review')
    chosen = min(runs, key=lambda run:abs((run[0]+run[-1]+window)/(2*rate)-estimate))
    return (chosen[0]+chosen[-1]+window)/(2*rate)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('request')
    args = parser.parse_args()
    request = json.loads(Path(args.request).read_text())
    from pypinyin import lazy_pinyin
    import soundfile as sf
    lines = request['lines']
    if chinese(request['sourceText']) != ''.join(chinese(row['text']) for row in lines):
        raise ValueError('Source recording text must equal the complete ordered dialogue')
    source = Path(request['audio'])
    evidence = json.loads(Path(request['asr']).read_text())
    if Path(evidence['audio']).resolve() != source.resolve():
        raise ValueError('ASR describes a different source file')
    words = [word for segment in evidence['segments'] for word in segment['words'] if chinese(word['word'])]
    boundaries = align_boundaries(lines, words, lazy_pinyin)
    info = sf.info(source)
    if info.duration > 60 or info.channels > 2 or info.samplerate > 96000:
        raise ValueError('Only bounded reference recordings are supported')
    audio, rate = sf.read(source, always_2d=True)
    first_word = boundaries[0]['firstWord']
    cuts = [silence_cut(audio, rate, words[first_word-1], words[first_word]) if first_word else 0.0]
    for left, right in zip(boundaries, boundaries[1:]):
        cuts.append(silence_cut(audio, rate, words[left['lastWord']], words[right['firstWord']]))
    last_word = boundaries[-1]['lastWord']
    cuts.append(silence_cut(audio, rate, words[last_word], words[last_word+1]) if last_word+1<len(words) else info.duration)
    if any(b <= a for a,b in zip(cuts,cuts[1:])):
        raise ValueError('Non-monotonic edit boundaries')
    out = Path(request['outputDir']); out.mkdir(parents=True, exist_ok=True)
    edits = []
    for index, row in enumerate(boundaries):
        line = row['line']
        if not line['id'].replace('-', '').isalnum():
            raise ValueError('Invalid line identifier')
        start, end = cuts[index:index+2]
        if end <= start:
            raise ValueError('Invalid edit interval')
        target = out/(line['id']+'.wav')
        if target.exists():
            raise ValueError('Refusing overwrite: '+str(target))
        clip = audio[round(start*rate):round(end*rate)]
        partial = target.with_suffix('.partial.wav')
        sf.write(partial, clip, rate)
        partial.replace(target)
        receipt = {**line,'seconds':len(clip)/rate,'sampleRate':rate,'sourceAudio':str(source),
            'sourceInSeconds':start,'sourceOutSeconds':end,'asrEvidence':request['asr'],
            'status':'CANDIDATE_REQUIRES_CUT_AND_LISTENING_REVIEW','cutMethod':'ASR-guided >=60ms waveform quiet gap',
            'model':'Qwen3-TTS-1.7B-VoiceDesign-4bit','note':'ASR boundaries and phonetic alignment are not final performance approval'}
        target.with_suffix('.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
        edits.append(receipt)
    (out/'edit-manifest.json').write_text(json.dumps({'lines':edits},ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'outputDir':str(out),'lines':len(edits)}))


if __name__ == '__main__':
    main()
