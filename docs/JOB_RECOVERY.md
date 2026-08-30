# Production Job Recovery

## Risk

The current `JobGraph` is structurally recoverable but stored only in process memory. Orchestrator restart loses story-generation and production execution maps. JSONL audit is not sufficient to reconstruct outputs and dependency state.

## Durable snapshot contract

After every transition, persist an atomic snapshot containing:

- project/run/job IDs and job type;
- status, dependencies, attempt/maxAttempts and progress;
- inputHash, provider/model/workflow version;
- startedAt, lastHeartbeat, completedAt and error;
- output assets, cost and transition sequence;
- plan/story/production versions and budget state.

The first implementation uses an append-safe JSON/file store behind an interface. Creator D1 can mirror the same contract. This remains replaceable by PostgreSQL/Redis later.

## Restart algorithm

1. load all nonterminal run snapshots;
2. validate graph identity/version and output receipts;
3. keep `SUCCEEDED` jobs only when input/dependency hashes and output hashes remain valid;
4. convert stale `RUNNING` jobs to `RETRYING`, increment no attempt until a worker claims them;
5. recompute readiness and blocked descendants;
6. resume from the first incomplete dependency frontier;
7. never restart completed Shot 1 when Shot 300 failed.

## Idempotency

The stable generation key is:

```text
projectId + productionVersion + jobId + inputHash + provider + modelVersion + workflowVersion
```

`attempt` is audit metadata and must not change the idempotency key. `forceRegenerate` creates an explicit new generation revision.

## Heartbeats and workers

Long jobs update `lastHeartbeat` without depending on terminal output. Status/health/log APIs read snapshots and process metadata; operators never need to kill a terminal merely to refresh output.

## Budget behavior

Before claim, reserve estimated cost including retry allowance. When the budget would be exceeded, mark the run `PAUSED_BUDGET` and leave jobs resumable. No provider request is made until the creator increases or approves the budget.
