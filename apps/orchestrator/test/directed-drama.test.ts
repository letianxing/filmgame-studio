import test from 'node:test';
import assert from 'node:assert/strict';
import fixture from '../../../examples/night-crossing/director-plan.json' with { type: 'json' };
import { validateDirectedDrama, type DirectedDramaPlan } from '../src/directed-drama.js';
test('director plan validates coverage, dialogue and bounded generation before external calls', () => {
  validateDirectedDrama(fixture);
  const over = structuredClone(fixture) as DirectedDramaPlan; over.limits.maxOutputSeconds = 20;
  assert.throws(() => validateDirectedDrama(over), /budget/);
  const overlap = structuredClone(fixture) as DirectedDramaPlan; overlap.segments[0]!.shots[1]!.start = 1;
  assert.throws(() => validateDirectedDrama(overlap), /contiguous/);
  const cycle = structuredClone(fixture) as DirectedDramaPlan; cycle.segments[0]!.referenceSegments = ['river'];
  assert.throws(() => validateDirectedDrama(cycle), /earlier/);
  const speech = structuredClone(fixture) as DirectedDramaPlan; speech.segments[0]!.dialogue[0]!.text = 'Unauthorised rewrite';
  assert.throws(() => validateDirectedDrama(speech), /exact dialogue/);
  const traversal = structuredClone(fixture) as DirectedDramaPlan; traversal.referenceImages = ['../.env.local'];
  assert.throws(() => validateDirectedDrama(traversal), /Invalid directed drama/);
  const missingReference = structuredClone(fixture) as DirectedDramaPlan; missingReference.segments[0]!.prompt += '\n@图片99';
  assert.throws(() => validateDirectedDrama(missingReference), /missing image/);
});
