import test from 'node:test';
import assert from 'node:assert/strict';
import { DreaminaAdapter } from '../../../services/dreamina-adapter/src/index.js';

function harness(options: {reverse?: boolean; wrongMode?: boolean} = {}) {
  const adapter = new DreaminaAdapter('unused');
  const calls: string[][] = [];
  const flags = [{flag:'--ratio',values:['16:9']},{flag:'--resolution',values:['720p']},{flag:'--duration',min:4,max:15}];
  adapter.models = async () => [{model:'model',modes:[
    ...[2,1].map(n => ({name:'first_last_frame',flags,references:{min:n,max:n,types:[{mediaType:'image',min:n,max:n}]}})),
    {name:'m2v',flags,references:{min:1,max:9,types:[{mediaType:'image',min:1,max:9}]}},
    {name:'t2v',flags,references:{min:0,max:0,types:[]}},
  ]}];
  adapter.call = async <T>(args: string[]): Promise<T> => {
    calls.push(args);
    if (args[1] === 'create') return {} as T;
    const create = calls.find(x => x[1] === 'create')!;
    const value = (key: string) => create[create.indexOf(key)+1];
    const references = create.flatMap((v,i) => v === '--ref' ? [{id:create[i+1]!.split(':')[1]}] : []);
    if (options.reverse) references.reverse();
    return {nodes:[{node:{nodeId:'node_test',generation:{model:'model',mode:options.wrongMode?'m2v':value('--mode'),prompt:'Action',durationSeconds:4,ratio:'16:9',resolution:'720p',references}}}]} as T;
  };
  const input = {canvasId:'canvas',nodeId:'node_test',updateId:'update',title:'Shot',prompt:'Action',model:'model',ratio:'16:9',resolution:'720p',duration:4};
  return {adapter,calls,input};
}

test('first/last mode sends and verifies ordered endpoints', async () => {
  const h=harness();
  await h.adapter.saveVideo({...h.input,mode:'first_last_frame',refs:['res:start','res:end']});
  const c=h.calls[0]!;
  assert.equal(c[c.indexOf('--mode')+1],'first_last_frame');
  assert.deepEqual(c.flatMap((v,i)=>v==='--ref'?[c[i+1]]:[]),['res:start','res:end']);
});
test('one first frame selects matching catalog entry rather than two-frame entry', async () => {
  const h=harness();
  await h.adapter.saveVideo({...h.input,mode:'first_last_frame',refs:['res:start']});
});
test('swapped endpoint readback and wrong mode fail before quote/run', async () => {
  for (const opts of [{reverse:true},{wrongMode:true}]) {
    const h=harness(opts);
    await assert.rejects(h.adapter.saveVideo({...h.input,mode:'first_last_frame',refs:['res:start','res:end']}),/回读/);
    assert.equal(h.calls.some(c=>c.includes('run')||c.includes('quote')),false);
  }
});
test('frame mode rejects audio, missing endpoints, and extra endpoints', async () => {
  const h=harness();
  for (const refs of [[],['res:a','res:b','res:c']])
    await assert.rejects(h.adapter.saveVideo({...h.input,mode:'first_last_frame',refs}),/ordered image/);
  await assert.rejects(h.adapter.saveVideo({...h.input,mode:'first_last_frame',refs:['res:a'],referenceTypes:['audio']}),/ordered image/);
  assert.equal(h.calls.length,0);
});
test('existing default m2v/t2v remains explicit and text-only rejects references', async () => {
  const h=harness();
  await h.adapter.saveVideo({...h.input,refs:['res:a']});
  assert.equal(h.calls[0]![h.calls[0]!.indexOf('--mode')+1],'m2v');
  const t=harness();await t.adapter.saveVideo(t.input);
  assert.equal(t.calls[0]![t.calls[0]!.indexOf('--mode')+1],'t2v');
  await assert.rejects(t.adapter.saveVideo({...t.input,mode:'t2v',refs:['res:a']}),/cannot use/);
});
