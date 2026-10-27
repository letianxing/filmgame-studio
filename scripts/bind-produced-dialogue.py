"""Bind exact screenplay lines without replacing reviewed takes on a later scan."""
import json
from pathlib import Path


def bind_dialogue(document, available):
    """Existing bindings win; ambiguous new takes require an explicit editorial choice."""
    bound = 0
    ambiguous = []
    for line in document['lines']:
        if line.get('audio'):
            bound += 1
            continue
        key = (line['characterId'], line['sceneId'], line['text'])
        matches = available.get(key, [])
        if len(matches) > 1:
            ambiguous.append({'lineId': line['id'], 'candidates': [str(wav) for wav, _ in matches]})
            continue
        if len(matches) == 1:
            wav, receipt = matches[0]
            line.update(audio=str(wav), audioSeconds=receipt['seconds'], audioReview='GENERATED_NOT_REVIEWED')
            bound += 1
    return {'bound': bound, 'total': len(document['lines']), 'missing': len(document['lines'])-bound, 'ambiguous': ambiguous}


def main():
    p = Path('productions/wolong-chengxiang/v5/dialogue-coverage.json')
    document = json.loads(p.read_text())
    available = {}
    for folder in sorted(Path('artifacts/wolong-local-film').glob('dialogue-*')):
        if not folder.is_dir():
            continue
        for receipt in sorted(folder.glob('*.json')):
            row = json.loads(receipt.read_text())
            if not isinstance(row, dict) or not all(k in row for k in ('characterId', 'sceneId', 'text', 'seconds')):
                continue
            wav = receipt.with_suffix('.wav')
            if not wav.is_file():
                raise ValueError('Receipt has no audio: '+str(receipt))
            available.setdefault((row['characterId'], row['sceneId'], row['text']), []).append((wav, row))
    for line in document['lines']:
        if line.get('audio') and not Path(line['audio']).is_file():
            raise ValueError('Existing audio binding is missing: '+line['audio'])
    result = bind_dialogue(document, available)
    partial = p.with_suffix('.partial.json')
    partial.write_text(json.dumps(document, ensure_ascii=False, indent=2)+'\n')
    partial.replace(p)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
