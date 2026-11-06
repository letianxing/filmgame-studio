import test from 'node:test';
import assert from 'node:assert/strict';
import {estimateNodeQuota, type QuotaTask} from '../src/node-quota.js';
test('node quota counts shared endings once and does not hide unknown audio',()=>{
 const ending:QuotaTask={assetId:'shared.ending',category:'story',units:8,creditsPerUnit:14,priceEvidence:'observed provider quote'};
 const q=estimateNodeQuota([ending,ending,{assetId:'old.idle',category:'loop',units:4,reused:true},
 {assetId:'voice',category:'audio',units:20}],397,.2);
 assert.equal(q.knownNewCredits,112);assert.equal(q.repairReserve,23);
 assert.equal(q.knownTotalWithReserve,532);assert.equal(q.complete,false);
 assert.deepEqual(q.unpricedAssets,['voice']);assert.equal(q.lines.length,3);
});
test('conflicting shared costs and invalid rates fail preflight',()=>{
 const a:QuotaTask={assetId:'a',category:'choice',units:4,creditsPerUnit:14,priceEvidence:'quote'};
 assert.throws(()=>estimateNodeQuota([a,{...a,units:8}],0,.2),/Conflicting/);
 assert.throws(()=>estimateNodeQuota([{...a,creditsPerUnit:NaN}],0,.2),/Invalid/);
 const {priceEvidence: _evidence, ...withoutEvidence}=a;
 assert.equal(estimateNodeQuota([withoutEvidence],0,.2).complete,false);
});
