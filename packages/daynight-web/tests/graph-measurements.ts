import { vi } from 'vitest';

export const installGraphMeasurements = () => {
  vi.stubGlobal('ResizeObserver', class {
    private readonly callback: ResizeObserverCallback;
    private readonly observed = new Set<Element>();
    private pending = false;
    constructor(callback: ResizeObserverCallback) { this.callback = callback; }
    observe(target: Element) {
      this.observed.add(target);
      if (this.pending) return;
      this.pending = true;
      queueMicrotask(() => {
        this.pending = false;
        if (this.observed.size > 0) this.callback([...this.observed].map((element) => ({ target: element, contentRect: element.getBoundingClientRect() } as ResizeObserverEntry)), this as unknown as ResizeObserver);
      });
    }
    unobserve(target: Element) { this.observed.delete(target); }
    disconnect() { this.observed.clear(); }
  });
  vi.stubGlobal('DOMMatrixReadOnly', class {
    readonly m22: number;
    constructor(transform: string) {
      this.m22 = Number(/scale\(([^)]+)\)/.exec(transform)?.[1] ?? 1);
    }
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('react-flow') || this.classList.contains('react-flow__renderer') ? 800 : this.classList.contains('react-flow__handle') ? 6 : 220;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('react-flow') || this.classList.contains('react-flow__renderer') ? 445 : this.classList.contains('react-flow__handle') ? 6 : 96;
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('react-flow') || this.classList.contains('task-graph-canvas')) return new DOMRect(0, 0, 800, 445);
    const node = this.closest<HTMLElement>('.react-flow__node');
    const position = /translate\(([^,]+)px,\s*([^)]+)px\)/.exec(node?.style.transform ?? '');
    const x = Number(position?.[1] ?? 0);
    const y = Number(position?.[2] ?? 0);
    if (this.classList.contains('react-flow__handle')) return new DOMRect(x, y, 6, 6);
    return new DOMRect(x, y, 220, 96);
  });
};
