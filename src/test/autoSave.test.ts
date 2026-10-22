// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAutoSave, type AutoSaveState } from '../hooks/useAutoSave';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HarnessProps = {
  value: number;
  save: (value: number) => Promise<void>;
  enabled?: boolean;
  delay?: number;
};

let latest: AutoSaveState | null = null;

function Harness({ value, save, enabled, delay }: HarnessProps) {
  latest = useAutoSave(value, save, { enabled, delay });
  return null;
}

const roots: Root[] = [];

function mount(props: HarnessProps) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(createElement(Harness, props));
  });
  return {
    update(next: HarnessProps) {
      act(() => {
        root.render(createElement(Harness, next));
      });
    },
    state(): AutoSaveState {
      if (!latest) throw new Error('hook did not render');
      return latest;
    },
  };
}

/** Let the debounce timer and the write promise both settle. */
const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  while (roots.length) {
    const root = roots.pop()!;
    act(() => root.unmount());
  }
  document.body.innerHTML = '';
  latest = null;
});

describe('useAutoSave', () => {
  it('does not write the value a form mounts with', async () => {
    const save = vi.fn(async () => {});
    const harness = mount({ value: 1, save, delay: 5 });
    await act(async () => {
      await settle();
    });
    expect(save).not.toHaveBeenCalled();
    expect(harness.state().status).toBe('saved');
    expect(harness.state().savedAt).toBeNull();
  });

  it('writes a changed value after the debounce and reports when', async () => {
    const save = vi.fn(async () => {});
    const harness = mount({ value: 1, save, delay: 5 });
    harness.update({ value: 2, save, delay: 5 });
    expect(harness.state().status).toBe('pending');
    await act(async () => {
      await settle();
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(2);
    expect(harness.state().status).toBe('saved');
    expect(harness.state().savedAt).toBeTypeOf('number');
    expect(harness.state().error).toBeNull();
  });

  it('keeps the change queued when a write fails and retries on the next edit', async () => {
    const save = vi
      .fn<(value: number) => Promise<void>>()
      .mockRejectedValueOnce(new Error('storage is full'))
      .mockResolvedValue(undefined);
    const harness = mount({ value: 1, save, delay: 5 });
    harness.update({ value: 2, save, delay: 5 });
    await act(async () => {
      await settle();
    });
    expect(harness.state().status).toBe('error');
    expect(harness.state().error).toBe('storage is full');

    harness.update({ value: 3, save, delay: 5 });
    await act(async () => {
      await settle();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(harness.state().status).toBe('saved');
    expect(harness.state().error).toBeNull();
  });

  it('flushes immediately and stays quiet while disabled', async () => {
    const save = vi.fn(async () => {});
    const harness = mount({ value: 1, save, delay: 60, enabled: false });
    harness.update({ value: 2, save, delay: 60, enabled: false });
    await act(async () => {
      await settle(80);
    });
    expect(save).not.toHaveBeenCalled();

    harness.update({ value: 2, save, delay: 60, enabled: true });
    await act(async () => {
      await harness.state().flush();
    });
    expect(save).toHaveBeenCalledWith(2);
    expect(harness.state().status).toBe('saved');
  });
});
