import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

export const LOCAL_AGENT_RUNNERS = ['pi', 'claude'];

function createMockSpawnSyncResult() {
  return {
    output: [],
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    status: 0,
    signal: null,
    error: undefined,
    pid: 0,
  };
}

function normalizeNewlines(text) {
  return String(text || '').replace(/\r\n/g, '\n');
}

function normalizePromptText(text) {
  return normalizeNewlines(text).trim();
}

function summarizeRawPrompt(prompt) {
  const normalized = normalizePromptText(prompt);
  if (!normalized) return '(empty prompt)';

  if (normalized.startsWith('---\n')) {
    const frontmatterEnd = normalized.indexOf('\n---\n', 4);
    if (frontmatterEnd !== -1) {
      const frontmatter = normalized.slice(4, frontmatterEnd);
      const nameLine = frontmatter
        .split('\n')
        .map((line) => line.trim())
        .find((line) => /^name\s*:/i.test(line));
      if (nameLine) {
        const name = nameLine.replace(/^name\s*:/i, '').trim();
        if (name) return `prompt=${name}`;
      }

      const body = normalized.slice(frontmatterEnd + 5).trim();
      const firstBodyLine = body
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean);
      if (firstBodyLine) return firstBodyLine;
    }
  }

  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines[0] || '(empty prompt)';
}

export class PiRunner {
  static callSkill(skillName, task = '') {
    const normalizedSkill = String(skillName || '').trim().toLowerCase();
    if (!normalizedSkill) throw new Error('Missing skillName');
    return {
      kind: 'skill',
      skillName: normalizedSkill,
      task: normalizePromptText(task),
    };
  }

  static pureExecutionNotASkill(prompt) {
    return {
      kind: 'raw',
      prompt: normalizePromptText(prompt),
    };
  }

  static renderPrompt(request) {
    if (request.kind === 'skill') {
      return request.task ? `/skill:${request.skillName}\n${request.task}` : `/skill:${request.skillName}`;
    }
    return normalizePromptText(request.prompt);
  }

  static summarize(request) {
    if (request.kind === 'skill') {
      const task = normalizePromptText(request.task || '');
      const firstTaskLine = task
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean);
      return firstTaskLine ? `skill=${request.skillName} task=${firstTaskLine}` : `skill=${request.skillName}`;
    }

    return summarizeRawPrompt(request.prompt);
  }

  static buildArgs(request, opts = {}) {
    const args = ['--mode', 'json'];
    const model = String(opts.model || '').trim();
    if (model) args.push('--model', model);
    const thinking = String(opts.thinking || '').trim();
    if (thinking) args.push('--thinking', thinking);
    const session = String(opts.session || '').trim();
    if (session) args.push('--session', session);
    args.push(PiRunner.renderPrompt(request));
    return args;
  }
}

export function parsePiRunRequest(prompt) {
  const text = normalizePromptText(prompt);
  const match = /^\/skill:([a-z0-9-]+)(?:\s*\n?([\s\S]*))?$/i.exec(text);
  if (!match) return PiRunner.pureExecutionNotASkill(text);

  const [, rawSkillName, rawTask] = match;
  return PiRunner.callSkill(rawSkillName, String(rawTask || ''));
}

export function normalizePiPrompt(prompt) {
  return PiRunner.renderPrompt(parsePiRunRequest(prompt));
}

export function buildPiSingleRunArgs(promptOrRequest, opts = {}) {
  const request = typeof promptOrRequest === 'string' ? parsePiRunRequest(promptOrRequest) : promptOrRequest;
  return PiRunner.buildArgs(request, opts);
}

function extractTextBlocksFromPiContent(content) {
  const record = content && typeof content === 'object' ? content : null;
  const list =
    Array.isArray(record?.content)
      ? record.content
      : Array.isArray(content)
        ? content
        : [];
  const parts = [];
  for (const item of list) {
    const block = item && typeof item === 'object' ? item : null;
    if (!block) continue;
    const type = typeof block.type === 'string' ? block.type.trim() : '';
    if (type === 'text' || type === 'summary_text') {
      const text = typeof block.text === 'string' ? block.text.trim() : '';
      if (text) parts.push(text);
    }
  }
  return parts;
}

export function extractAssistantTextFromPiJson(output) {
  const texts = [];
  for (const line of String(output || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.type !== 'string' || parsed.type !== 'message_end') continue;
      const message = parsed.message;
      if (typeof message?.role !== 'string' || message.role !== 'assistant') continue;
      const text = extractTextBlocksFromPiContent(message).join('\n\n').trim();
      if (text) texts.push(text);
    } catch {
      // ignore non-json lines
    }
  }
  return texts.join('\n\n').trim();
}

export function extractLastAssistantTextFromPiJson(output) {
  let last = '';
  for (const line of String(output || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.type !== 'string' || parsed.type !== 'message_end') continue;
      const message = parsed.message;
      if (typeof message?.role !== 'string' || message.role !== 'assistant') continue;
      const text = extractTextBlocksFromPiContent(message).join('\n\n').trim();
      if (text) last = text;
    } catch {
      // ignore non-json lines
    }
  }
  return last;
}

const PROMPT_ARG_SIZE_THRESHOLD = 200_000;

export function materializeArgsForSpawn(args) {
  if (args.length === 0) return { args };

  const lastArg = args[args.length - 1];
  if (Buffer.byteLength(lastArg, 'utf-8') <= PROMPT_ARG_SIZE_THRESHOLD) {
    return { args };
  }

  const dir = mkdtempSync(join(tmpdir(), 'pi-prompt-'));
  const filePath = join(dir, 'prompt.md');
  writeFileSync(filePath, lastArg, 'utf-8');

  return {
    args: [...args.slice(0, -1), `@${filePath}`],
    promptFile: filePath,
  };
}

export function buildClaudePrintArgs(prompt, opts = {}) {
  const text = String(prompt || '').trim();
  if (!text) throw new Error('buildClaudePrintArgs: prompt is required');
  const args = ['-p', '--verbose', '--output-format', 'stream-json'];
  const permissionMode = String(opts.permissionMode || '').trim();
  const model = String(opts.model || '').trim();
  const effort = String(opts.effort || '').trim();
  if (permissionMode) args.push('--permission-mode', permissionMode);
  if (model) args.push('--model', model);
  if (effort) args.push('--effort', effort);
  return args;
}

export function buildLocalAgentSpawnSpec(opts) {
  const prompt = String(opts.prompt || '').trim();
  if (!prompt) throw new Error('buildLocalAgentSpawnSpec: prompt is required');

  if (opts.runner === 'claude') {
    if (prompt.startsWith('/skill:')) {
      throw new Error('Claude runner does not support /skill: prompts. Render the full prompt text before dispatch.');
    }
    const baseUrl = String(opts.baseUrl || '').trim();
    return {
      command: 'claude',
      args: buildClaudePrintArgs(prompt, {
        model: opts.model,
        effort: opts.effort,
        permissionMode: opts.permissionMode,
      }),
      env: baseUrl ? { ANTHROPIC_BASE_URL: baseUrl } : {},
      stdinText: `${prompt}\n`,
    };
  }

  const materialized = materializeArgsForSpawn(buildPiSingleRunArgs(prompt, {
    thinking: opts.effort,
    session: opts.sessionId,
    model: opts.model,
  }));
  const spec = {
    command: 'pi',
    args: materialized.args,
    env: { PI_SKIP_VERSION_CHECK: '1' },
  };
  if (materialized.promptFile) spec.tempFiles = [materialized.promptFile];
  return spec;
}

export function spawnLocalAgentProcess(opts) {
  const child = spawn(opts.spec.command, opts.spec.args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: [opts.spec.stdinText !== undefined ? 'pipe' : 'ignore', opts.stdoutFd, opts.stderrFd],
    detached: opts.detached,
  });
  if (opts.spec.stdinText !== undefined) child.stdin?.end(opts.spec.stdinText);
  return child;
}

export function runLocalAgentSpawnSpecSync(opts) {
  return spawnSync(opts.spec.command, opts.spec.args, {
    cwd: opts.cwd,
    env: opts.env,
    input: opts.spec.stdinText,
    stdio: [opts.spec.stdinText !== undefined ? 'pipe' : 'ignore', opts.stdoutFd, opts.stderrFd],
  });
}

export class LocalAgentExecutor {
  buildSpawnSpec(request) {
    return buildLocalAgentSpawnSpec(request);
  }

  spawn(opts) {
    return spawnLocalAgentProcess({
      spec: this.buildSpawnSpec(opts.request),
      cwd: opts.cwd,
      env: opts.env,
      stdoutFd: opts.stdoutFd,
      stderrFd: opts.stderrFd,
      detached: opts.detached,
    });
  }

  runSync(opts) {
    return runLocalAgentSpawnSpecSync({
      spec: this.buildSpawnSpec(opts.request),
      cwd: opts.cwd,
      env: opts.env,
      stdoutFd: opts.stdoutFd,
      stderrFd: opts.stderrFd,
    });
  }
}

export class MockLocalAgentExecutor {
  constructor(config = {}) {
    this.buildSpawnSpecCalls = [];
    this.spawnCalls = [];
    this.runSyncCalls = [];
    this.buildSpawnSpecImpl = config.buildSpawnSpecImpl;
    this.spawnImpl = config.spawnImpl;
    this.runSyncImpl = config.runSyncImpl;
    this.defaultSpawnSpec = config.defaultSpawnSpec;
    this.defaultSpawnResult = config.defaultSpawnResult;
    this.defaultRunSyncResult = config.defaultRunSyncResult;
  }

  buildSpawnSpec(request) {
    this.buildSpawnSpecCalls.push(request);
    if (this.buildSpawnSpecImpl) return this.buildSpawnSpecImpl(request);
    if (this.defaultSpawnSpec) return this.defaultSpawnSpec;
    return buildLocalAgentSpawnSpec(request);
  }

  spawn(opts) {
    this.spawnCalls.push(opts);
    if (this.spawnImpl) return this.spawnImpl(opts);
    return this.defaultSpawnResult || {
      pid: 0,
      stdin: { end() {} },
    };
  }

  runSync(opts) {
    this.runSyncCalls.push(opts);
    if (this.runSyncImpl) return this.runSyncImpl(opts);
    return this.defaultRunSyncResult || createMockSpawnSyncResult();
  }
}
