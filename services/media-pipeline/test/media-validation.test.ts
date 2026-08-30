import assert from 'node:assert/strict';
import test from 'node:test';

import { parseMediaSignalLog, validateMediaProbe } from '../src/index.js';

test('media validator rejects wrong aspect ratio and missing audio', () => {
  const result = validateMediaProbe(
    {
      format: { duration: '5.0' },
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 720, height: 720, avg_frame_rate: '24/1' }],
    },
    { requireAudio: true, expectedAspectRatio: 16 / 9, allowedVideoCodecs: ['h264'] },
  );
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((issue) => issue.code === 'MISSING_AUDIO'));
  assert.ok(result.issues.some((issue) => issue.code === 'ASPECT_RATIO_MISMATCH'));
});

test('signal log parser flags black and silent segments for review', () => {
  const result = parseMediaSignalLog('black_start:0 black_end:2\nsilence_start: 4\nsilence_end: 6');
  assert.equal(result.blackSegments, 1);
  assert.equal(result.silentSegments, 1);
  assert.equal(result.issues.length, 2);
});
