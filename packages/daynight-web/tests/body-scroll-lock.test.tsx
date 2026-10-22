import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useBodyScrollLock } from '../src/app/useBodyScrollLock';

const Lock = ({ active = true }: { active?: boolean }) => {
  useBodyScrollLock(active);
  return null;
};

describe('body scroll locks', () => {
  it.each(['first', 'second'] as const)('restores the original overflow only after both locks release when %s exits first', (firstRelease) => {
    document.body.style.overflow = 'scroll';
    const first = render(<Lock />);
    const second = render(<Lock />);
    expect(document.body.style.overflow).toBe('hidden');
    const views = firstRelease === 'first' ? [first, second] : [second, first];
    views[0]!.unmount();
    expect(document.body.style.overflow).toBe('hidden');
    views[1]!.unmount();
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });

  it('acquires and releases when fullscreen changes without losing another active lock', () => {
    document.body.style.overflow = 'auto';
    const graph = render(<Lock active={false} />);
    expect(document.body.style.overflow).toBe('auto');
    graph.rerender(<Lock active={true} />);
    const dialog = render(<Lock />);
    graph.rerender(<Lock active={false} />);
    expect(document.body.style.overflow).toBe('hidden');
    dialog.unmount();
    expect(document.body.style.overflow).toBe('auto');
    graph.unmount();
    document.body.style.overflow = '';
  });
});
