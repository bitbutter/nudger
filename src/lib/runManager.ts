import type { Reply } from '../types';
import { asNudgeError, NudgeError } from './errors';
import type { RetryInfo, RunJob } from './run';

export type RunPhase = 'queued' | 'running' | 'retrying' | 'error' | 'quiet';

export type RunState = {
  phase: RunPhase;
  nudgerId: string;
  documentId: string;
  startedAt: number;
  error?: NudgeError;
  attempt?: number;
  retryInMs?: number;
  message?: string;
};

export type ExecuteJob = (job: RunJob, handlers: { signal: AbortSignal; onRetry?: (info: RetryInfo) => void }) => Promise<Reply | null>;

type ManagerOptions = {
  execute: ExecuteJob;
  onStates: (states: Record<string, RunState>) => void;
  onError?: (state: RunState) => void;
};

type QueuedJob = RunJob & { nudgerId: string; documentId: string };

/**
 * A small, React-free scheduler. It guarantees at most one in-flight call per
 * nudger and a global concurrency cap, and keeps per-nudger UI state.
 */
export class RunManager {
  private queue: QueuedJob[] = [];
  private active = new Map<string, AbortController>();
  private states: Record<string, RunState> = {};
  private maxConcurrent = 2;
  private readonly execute: ExecuteJob;
  private readonly onStates: ManagerOptions['onStates'];
  private readonly onError?: ManagerOptions['onError'];

  constructor(options: ManagerOptions) {
    this.execute = options.execute;
    this.onStates = options.onStates;
    this.onError = options.onError;
  }

  setMaxConcurrent(value: number): void {
    this.maxConcurrent = Math.max(1, Math.min(8, Math.round(value)));
    this.pump();
  }

  getStates(): Record<string, RunState> {
    return { ...this.states };
  }

  isBusy(nudgerId: string): boolean {
    return this.active.has(nudgerId) || this.queue.some((job) => job.nudgerId === nudgerId);
  }

  activeCount(): number {
    return this.active.size;
  }

  enqueue(job: RunJob): 'started' | 'queued' | 'duplicate' {
    const nudgerId = job.prepared.nudgerId;
    if (this.isBusy(nudgerId)) return 'duplicate';
    const queued: QueuedJob = {
      ...job,
      nudgerId,
      documentId: job.prepared.documentId,
    };
    this.queue.push(queued);
    this.setState(nudgerId, {
      phase: 'queued',
      nudgerId,
      documentId: queued.documentId,
      startedAt: Date.now(),
    });
    this.pump();
    return this.active.has(nudgerId) ? 'started' : 'queued';
  }

  cancel(nudgerId: string): void {
    const before = this.queue.length;
    this.queue = this.queue.filter((job) => job.nudgerId !== nudgerId);
    const controller = this.active.get(nudgerId);
    if (controller) controller.abort();
    if (before !== this.queue.length || !controller) {
      this.clearState(nudgerId);
    }
  }

  cancelAll(): void {
    this.queue = [];
    for (const controller of this.active.values()) controller.abort();
    this.states = {};
    this.emit();
  }

  /** Cancels queued and in-flight work that belongs to one document. */
  cancelDocument(documentId: string): void {
    const ids = new Set(
      Object.values(this.states)
        .filter((state) => state.documentId === documentId)
        .map((state) => state.nudgerId),
    );
    this.queue = this.queue.filter((job) => job.documentId !== documentId);
    for (const id of ids) {
      this.active.get(id)?.abort();
      this.clearState(id);
    }
    this.emit();
    this.pump();
  }

  private pump(): void {
    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift();
      if (!job) break;
      if (this.active.has(job.nudgerId)) continue;
      this.start(job);
    }
  }

  private start(job: QueuedJob): void {
    const controller = new AbortController();
    this.active.set(job.nudgerId, controller);
    this.setState(job.nudgerId, {
      phase: 'running',
      nudgerId: job.nudgerId,
      documentId: job.documentId,
      startedAt: Date.now(),
    });

    void (async () => {
      try {
        const reply = await this.execute(job, {
          signal: controller.signal,
          onRetry: (info) => {
            this.setState(job.nudgerId, {
              phase: 'retrying',
              nudgerId: job.nudgerId,
              documentId: job.documentId,
              startedAt: this.states[job.nudgerId]?.startedAt ?? Date.now(),
              attempt: info.attempt,
              retryInMs: info.retryInMs,
              message: info.message,
            });
          },
        });
        if (reply) {
          this.clearState(job.nudgerId);
        } else {
          // Nothing was raised, so nothing is saved. The phase stays on the
          // card until the next run for this nudger replaces it.
          this.setState(job.nudgerId, {
            phase: 'quiet',
            nudgerId: job.nudgerId,
            documentId: job.documentId,
            startedAt: this.states[job.nudgerId]?.startedAt ?? Date.now(),
          });
        }
      } catch (error) {
        const nudgeError = asNudgeError(error);
        if (nudgeError.kind === 'cancelled') {
          this.clearState(job.nudgerId);
        } else {
          const state: RunState = {
            phase: 'error',
            nudgerId: job.nudgerId,
            documentId: job.documentId,
            startedAt: this.states[job.nudgerId]?.startedAt ?? Date.now(),
            error: nudgeError,
          };
          this.setState(job.nudgerId, state);
          this.onError?.(state);
        }
      } finally {
        this.active.delete(job.nudgerId);
        this.emit();
        this.pump();
      }
    })();
  }

  private setState(nudgerId: string, state: RunState): void {
    this.states = { ...this.states, [nudgerId]: state };
    this.emit();
  }

  private clearState(nudgerId: string): void {
    if (!(nudgerId in this.states)) return;
    const next = { ...this.states };
    delete next[nudgerId];
    this.states = next;
    this.emit();
  }

  private emit(): void {
    this.onStates({ ...this.states });
  }
}

export function isRateLimited(state: RunState | undefined): boolean {
  return Boolean(state?.error && state.error.kind === 'rate_limit');
}

export function runStateMessage(state: RunState): string {
  if (state.phase === 'queued') return 'Queued';
  if (state.phase === 'running') return 'Reading your draft…';
  if (state.phase === 'retrying') {
    return `${state.message ?? 'Retrying'} (attempt ${state.attempt ?? 2}, about ${Math.ceil((state.retryInMs ?? 0) / 1000)}s)`;
  }
  if (state.phase === 'quiet') return 'Nothing new to flag';
  if (state.error) return state.error.message;
  return '';
}
