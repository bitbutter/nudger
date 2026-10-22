// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutoRunTrigger } from '../lib/autoRunTrigger';

function moveMouse(): void {
  window.dispatchEvent(new Event('pointermove'));
}

describe('auto-run trigger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires after the cooldown when the mouse moved during it', () => {
    const onReady = vi.fn();
    createAutoRunTrigger({ delayMs: 1500, onReady });

    vi.advanceTimersByTime(500);
    moveMouse();
    expect(onReady).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('waits for the mouse when the cooldown elapses first', () => {
    const onReady = vi.fn();
    createAutoRunTrigger({ delayMs: 1500, onReady });

    vi.advanceTimersByTime(1500);
    expect(onReady).not.toHaveBeenCalled();

    moveMouse();
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('never fires on a resting mouse', () => {
    const onReady = vi.fn();
    createAutoRunTrigger({ delayMs: 1000, onReady });

    vi.advanceTimersByTime(60_000);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('fires once, however much the mouse moves afterwards', () => {
    const onReady = vi.fn();
    createAutoRunTrigger({ delayMs: 1000, onReady });

    vi.advanceTimersByTime(1000);
    moveMouse();
    moveMouse();
    vi.advanceTimersByTime(10_000);
    moveMouse();

    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('does not fire after cancel', () => {
    const onReady = vi.fn();
    const cancel = createAutoRunTrigger({ delayMs: 1000, onReady });

    cancel();
    moveMouse();
    vi.advanceTimersByTime(10_000);

    expect(onReady).not.toHaveBeenCalled();
  });
});
