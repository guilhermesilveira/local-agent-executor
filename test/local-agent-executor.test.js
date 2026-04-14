import { describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
const spawnSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

describe('local-agent-executor', () => {
  it('builds a pi spawn spec with generic effort and session', async () => {
    const { buildLocalAgentSpawnSpec } = await import('../index.js');

    expect(buildLocalAgentSpawnSpec({
      prompt: 'Hello world',
      runner: 'pi',
      model: 'openai/gpt-5.4',
      effort: 'high',
      sessionId: 'session-1',
    })).toEqual({
      command: 'pi',
      args: ['--mode', 'json', '--model', 'openai/gpt-5.4', '--thinking', 'high', '--session', 'session-1', 'Hello world'],
      env: { PI_SKIP_VERSION_CHECK: '1' },
    });
  });

  it('builds a claude spawn spec with generic effort and baseUrl', async () => {
    const { buildLocalAgentSpawnSpec } = await import('../index.js');

    expect(buildLocalAgentSpawnSpec({
      prompt: 'Defend this complaint',
      runner: 'claude',
      model: 'claude-opus-4-6',
      effort: 'high',
      baseUrl: 'http://localhost:3456',
      permissionMode: 'bypassPermissions',
    })).toEqual({
      command: 'claude',
      args: ['-p', '--verbose', '--output-format', 'stream-json', '--permission-mode', 'bypassPermissions', '--model', 'claude-opus-4-6', '--effort', 'high'],
      env: { ANTHROPIC_BASE_URL: 'http://localhost:3456' },
      stdinText: 'Defend this complaint\n',
    });
  });

  it('rejects claude skill invocation shims', async () => {
    const { buildLocalAgentSpawnSpec } = await import('../index.js');

    expect(() => buildLocalAgentSpawnSpec({
      prompt: '/skill:paper-defend\nfix complaint',
      runner: 'claude',
    })).toThrow(/does not support \/skill:/i);
  });

  it('preserves explicit pi skill prompts and helper rendering', async () => {
    const { PiRunner, buildPiSingleRunArgs, normalizePiPrompt, parsePiRunRequest } = await import('../index.js');

    expect(parsePiRunRequest('/skill:research-experiment\nrun experiment exp002 of OBJ-01')).toEqual({
      kind: 'skill',
      skillName: 'research-experiment',
      task: 'run experiment exp002 of OBJ-01',
    });
    expect(normalizePiPrompt('/skill:research-experiment\nrun experiment exp002 of OBJ-01')).toBe('/skill:research-experiment\nrun experiment exp002 of OBJ-01');
    expect(buildPiSingleRunArgs(PiRunner.pureExecutionNotASkill('echo hello'))).toEqual(['--mode', 'json', 'echo hello']);
  });

  it('extracts assistant text from pi json output', async () => {
    const { extractAssistantTextFromPiJson, extractLastAssistantTextFromPiJson } = await import('../index.js');
    const output = [
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"First answer"}]}}',
      '{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"ignored"}]}}',
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"Second answer"}]}}',
    ].join('\n');

    expect(extractAssistantTextFromPiJson(output)).toBe('First answer\n\nSecond answer');
    expect(extractLastAssistantTextFromPiJson(output)).toBe('Second answer');
  });

  it('spawns processes through mocked child_process.spawn', async () => {
    const child = { stdin: { end: vi.fn() } };
    spawnMock.mockReturnValueOnce(child);
    const { spawnLocalAgentProcess } = await import('../index.js');

    const result = spawnLocalAgentProcess({
      spec: {
        command: 'claude',
        args: ['-p'],
        env: { ANTHROPIC_BASE_URL: 'http://localhost:3456' },
        stdinText: 'run this\n',
      },
      cwd: '/tmp/project',
      env: { PATH: process.env.PATH || '' },
      stdoutFd: 1,
      stderrFd: 2,
      detached: true,
    });

    expect(result).toBe(child);
    expect(spawnMock).toHaveBeenCalledWith('claude', ['-p'], expect.objectContaining({
      cwd: '/tmp/project',
      stdio: ['pipe', 1, 2],
      detached: true,
    }));
    expect(child.stdin.end).toHaveBeenCalledWith('run this\n');
  });

  it('runs sync processes through mocked child_process.spawnSync', async () => {
    const syncResult = { status: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    spawnSyncMock.mockReturnValueOnce(syncResult);
    const { runLocalAgentSpawnSpecSync } = await import('../index.js');

    const result = runLocalAgentSpawnSpecSync({
      spec: {
        command: 'pi',
        args: ['--mode', 'json', 'hello'],
        env: { PI_SKIP_VERSION_CHECK: '1' },
      },
      cwd: '/tmp/project',
      env: { PATH: process.env.PATH || '' },
      stdoutFd: 1,
      stderrFd: 2,
    });

    expect(result).toBe(syncResult);
    expect(spawnSyncMock).toHaveBeenCalledWith('pi', ['--mode', 'json', 'hello'], expect.objectContaining({
      cwd: '/tmp/project',
      stdio: ['ignore', 1, 2],
    }));
  });

  it('provides a mock executor with call recording', async () => {
    const { MockLocalAgentExecutor } = await import('../index.js');

    const executor = new MockLocalAgentExecutor({
      defaultSpawnSpec: { command: 'pi', args: ['--mode', 'json', 'hello'], env: { PI_SKIP_VERSION_CHECK: '1' } },
    });

    const spec = executor.buildSpawnSpec({ runner: 'pi', prompt: 'hello' });
    const spawned = executor.spawn({
      request: { runner: 'pi', prompt: 'hello' },
      cwd: '/tmp/project',
      env: {},
      stdoutFd: 1,
      stderrFd: 2,
    });
    const syncResult = executor.runSync({
      request: { runner: 'claude', prompt: 'hi' },
      cwd: '/tmp/project',
      env: {},
      stdoutFd: 1,
      stderrFd: 2,
    });

    expect(spec.command).toBe('pi');
    expect(executor.buildSpawnSpecCalls).toEqual([{ runner: 'pi', prompt: 'hello' }]);
    expect(executor.spawnCalls).toHaveLength(1);
    expect(executor.runSyncCalls).toHaveLength(1);
    expect(spawned).toMatchObject({ pid: 0 });
    expect(syncResult.status).toBe(0);
  });
});
