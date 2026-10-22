import { useLayoutEffect } from 'react';

const locks = new WeakMap<HTMLElement, { count: number; overflow: string }>();

export const useBodyScrollLock = (active: boolean) => {
  useLayoutEffect(() => {
    if (!active) return;
    const body = document.body;
    let lock = locks.get(body);
    if (lock === undefined) {
      lock = { count: 0, overflow: body.style.overflow };
      locks.set(body, lock);
      body.style.overflow = 'hidden';
    }
    lock.count += 1;
    return () => {
      lock.count -= 1;
      if (lock.count === 0) {
        body.style.overflow = lock.overflow;
        locks.delete(body);
      }
    };
  }, [active]);
};
