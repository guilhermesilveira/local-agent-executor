# local-agent-executor

Small local executor for `pi` and `claude` CLI runs.

It provides:

- spawn-spec builders for `pi` and `claude`
- thin helpers for `spawn` and `spawnSync`
- `pi` prompt parsing helpers
- `pi` JSON output extraction helpers
- `LocalAgentExecutor` for normal use
- `MockLocalAgentExecutor` for tests

## Install

From GitHub:

```bash
npm install github:guilhermesilveira/local-agent-executor
```

Or from a local checkout:

```bash
npm install /path/to/local-agent-executor
```

## What It Solves

This package is useful when you want one small abstraction around local agent CLIs without committing to a bigger framework.

It keeps the shared concepts generic:

- `runner`
- `prompt`
- `model`
- `effort`
- `baseUrl`
- `sessionId`

Then it maps those to runner-specific behavior:

- `pi`: `effort` maps to `--thinking`
- `claude`: `effort` maps to `--effort`
- `claude`: `baseUrl` maps to `ANTHROPIC_BASE_URL`

## Basic Usage

```js
import { LocalAgentExecutor } from '@guilhermesilveira/local-agent-executor';

const executor = new LocalAgentExecutor();

const spec = executor.buildSpawnSpec({
  runner: 'claude',
  prompt: 'Summarize the diff.',
  model: 'claude-sonnet-4-6',
  effort: 'medium',
  baseUrl: 'http://localhost:3456',
  permissionMode: 'bypassPermissions',
});

console.log(spec);
```

## Build A Spawn Spec Directly

```js
import { buildLocalAgentSpawnSpec } from '@guilhermesilveira/local-agent-executor';

const spec = buildLocalAgentSpawnSpec({
  runner: 'pi',
  prompt: 'Check the repo state.',
  model: 'openai/gpt-5.4',
  effort: 'high',
  sessionId: 'session-123',
});
```

## Pi Helpers

```js
import {
  PiRunner,
  buildPiSingleRunArgs,
  parsePiRunRequest,
  extractLastAssistantTextFromPiJson,
} from '@guilhermesilveira/local-agent-executor';

const request = PiRunner.callSkill('todo', 'list all tasks');
const args = buildPiSingleRunArgs(request, { thinking: 'high' });

const parsed = parsePiRunRequest('/skill:todo\nlist all tasks');
const answer = extractLastAssistantTextFromPiJson(outputText);
```

## Testing

The package is built to be easy to test without running real CLIs.

### Mock `spawn` and `spawnSync`

The low-level helpers are ordinary wrappers around `node:child_process`, so your tests can mock those directly.

### Use `MockLocalAgentExecutor`

```js
import { MockLocalAgentExecutor } from '@guilhermesilveira/local-agent-executor';

const executor = new MockLocalAgentExecutor({
  defaultSpawnSpec: {
    command: 'pi',
    args: ['--mode', 'json', 'hello'],
    env: { PI_SKIP_VERSION_CHECK: '1' },
  },
});

executor.buildSpawnSpec({ runner: 'pi', prompt: 'hello' });

expect(executor.buildSpawnSpecCalls).toHaveLength(1);
```

The mock records:

- `buildSpawnSpecCalls`
- `spawnCalls`
- `runSyncCalls`

It also lets you override behavior with:

- `buildSpawnSpecImpl`
- `spawnImpl`
- `runSyncImpl`

## API

Main exports:

- `buildLocalAgentSpawnSpec`
- `spawnLocalAgentProcess`
- `runLocalAgentSpawnSpecSync`
- `LocalAgentExecutor`
- `MockLocalAgentExecutor`
- `PiRunner`
- `parsePiRunRequest`
- `normalizePiPrompt`
- `buildPiSingleRunArgs`
- `extractAssistantTextFromPiJson`
- `extractLastAssistantTextFromPiJson`
- `buildClaudePrintArgs`

## Development

Run tests:

```bash
npm test
```

## License

MIT
