import type { ChildProcess, SpawnSyncReturns } from 'node:child_process';

export type LocalAgentRunner = 'pi' | 'claude';

export interface PiRunRequestSkill {
  kind: 'skill';
  skillName: string;
  task?: string;
}

export interface PiRunRequestRaw {
  kind: 'raw';
  prompt: string;
}

export type PiRunRequest = PiRunRequestSkill | PiRunRequestRaw;

export interface PiRunOptions {
  session?: string;
  thinking?: string;
  model?: string;
}

export interface ClaudePrintOptions {
  model?: string;
  effort?: string;
  permissionMode?: string;
}

export interface LocalAgentExecutionOptions {
  prompt: string;
  runner: LocalAgentRunner;
  model?: string;
  sessionId?: string;
  effort?: string;
  baseUrl?: string;
  permissionMode?: string;
}

export interface LocalAgentSpawnSpec {
  command: string;
  args: string[];
  env: Record<string, string>;
  stdinText?: string;
  tempFiles?: string[];
}

export interface MaterializedArgs {
  args: string[];
  promptFile?: string;
}

export const LOCAL_AGENT_RUNNERS: readonly ['pi', 'claude'];

export class PiRunner {
  static callSkill(skillName: string, task?: string): PiRunRequest;
  static pureExecutionNotASkill(prompt: string): PiRunRequest;
  static renderPrompt(request: PiRunRequest): string;
  static summarize(request: PiRunRequest): string;
  static buildArgs(request: PiRunRequest, opts?: PiRunOptions): string[];
}

export function parsePiRunRequest(prompt: string): PiRunRequest;
export function normalizePiPrompt(prompt: string): string;
export function buildPiSingleRunArgs(promptOrRequest: string | PiRunRequest, opts?: PiRunOptions): string[];
export function extractAssistantTextFromPiJson(output: string): string;
export function extractLastAssistantTextFromPiJson(output: string): string;
export function materializeArgsForSpawn(args: string[]): MaterializedArgs;
export function buildClaudePrintArgs(prompt: string, opts?: ClaudePrintOptions): string[];
export function buildLocalAgentSpawnSpec(opts: LocalAgentExecutionOptions): LocalAgentSpawnSpec;
export function spawnLocalAgentProcess(opts: {
  spec: LocalAgentSpawnSpec;
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdoutFd: number;
  stderrFd: number;
  detached?: boolean;
}): ChildProcess;
export function runLocalAgentSpawnSpecSync(opts: {
  spec: LocalAgentSpawnSpec;
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdoutFd: number;
  stderrFd: number;
}): SpawnSyncReturns<Buffer>;
