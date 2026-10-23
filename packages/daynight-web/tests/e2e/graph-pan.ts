import type { Page } from '@playwright/test';

export const panPoint = (page: Page) => page.evaluate(() => {
  const canvas = document.querySelector('.task-graph-canvas')!;
  const bounds = canvas.getBoundingClientRect();
  for (let y = bounds.top + 16; y < bounds.bottom - 50; y += 24) {
    for (let x = bounds.left + 16; x < bounds.right - 70; x += 24) {
      const target = document.elementFromPoint(x, y);
      if (target?.closest('.react-flow__pane') !== null && target?.closest('.task-node,.react-flow__controls,.react-flow__attribution') === null) return { x, y };
    }
  }
  throw new Error('No accessible blank canvas position is available for the pan interaction.');
});
