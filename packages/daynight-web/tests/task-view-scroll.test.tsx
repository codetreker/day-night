import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTaskViewScroll, type TaskView } from '../src/features/projects/useProjectViewPreferences';

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty('overflow-anchor');
});

describe('task view scroll ownership', () => {
  it('disables native anchoring before restoring a saved position and releases it when not ready', () => {
    window.localStorage.setItem('daynight:task-view-scroll:project', JSON.stringify({ chains: 320, standalone: 540 }));
    const observedPolicies: string[] = [];
    vi.mocked(window.scrollTo).mockImplementation(() => {
      observedPolicies.push(document.documentElement.style.getPropertyValue('overflow-anchor'));
    });
    const hook = renderHook(({ ready, view }: { ready: boolean; view: TaskView }) => useTaskViewScroll('project', view, ready), {
      initialProps: { ready: false, view: 'chains' },
    });
    expect(document.documentElement.style.getPropertyValue('overflow-anchor')).toBe('');
    expect(window.scrollTo).not.toHaveBeenCalled();
    hook.rerender({ ready: true, view: 'chains' });
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 320, behavior: 'instant' });
    hook.rerender({ ready: true, view: 'standalone' });
    expect(window.scrollTo).toHaveBeenLastCalledWith({ top: 540, behavior: 'instant' });
    expect(observedPolicies).toEqual(['none', 'none']);
    hook.rerender({ ready: false, view: 'standalone' });
    expect(document.documentElement.style.getPropertyValue('overflow-anchor')).toBe('');
  });

  it('restores the prior inline value and priority on unmount', () => {
    document.documentElement.style.setProperty('overflow-anchor', 'auto', 'important');
    const hook = renderHook(() => useTaskViewScroll('project', 'chains', true));
    expect(document.documentElement.style.getPropertyValue('overflow-anchor')).toBe('none');
    expect(document.documentElement.style.getPropertyPriority('overflow-anchor')).toBe('important');
    hook.unmount();
    expect(document.documentElement.style.getPropertyValue('overflow-anchor')).toBe('auto');
    expect(document.documentElement.style.getPropertyPriority('overflow-anchor')).toBe('important');
  });

  it('retains the policy until the last scroll owner unmounts', () => {
    const first = renderHook(() => useTaskViewScroll('first', 'chains', true));
    const second = renderHook(() => useTaskViewScroll('second', 'standalone', true));
    first.unmount();
    expect(document.documentElement.style.getPropertyValue('overflow-anchor')).toBe('none');
    second.unmount();
    expect(document.documentElement.style.getPropertyValue('overflow-anchor')).toBe('');
    const next = renderHook(() => useTaskViewScroll('next', 'chains', true));
    expect(document.documentElement.style.getPropertyValue('overflow-anchor')).toBe('none');
    next.unmount();
    expect(document.documentElement.style.getPropertyValue('overflow-anchor')).toBe('');
  });

  it('preserves a replacement policy written by another owner', () => {
    const hook = renderHook(() => useTaskViewScroll('project', 'chains', true));
    document.documentElement.style.setProperty('overflow-anchor', 'auto');
    hook.unmount();
    expect(document.documentElement.style.getPropertyValue('overflow-anchor')).toBe('auto');
  });

  it('preserves a replacement priority written by another owner', () => {
    const hook = renderHook(() => useTaskViewScroll('project', 'chains', true));
    document.documentElement.style.setProperty('overflow-anchor', 'none', 'important');
    hook.unmount();
    expect(document.documentElement.style.getPropertyValue('overflow-anchor')).toBe('none');
    expect(document.documentElement.style.getPropertyPriority('overflow-anchor')).toBe('important');
  });
});
