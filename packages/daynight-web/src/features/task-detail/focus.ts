import { tabbable, type FocusableElement } from 'tabbable';

export const drawerFocusables = (root: Document | HTMLElement): FocusableElement[] => {
  const container = 'documentElement' in root ? root.body : root;
  if (container === null) return [];
  return tabbable(container);
};
