import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { tabbable } from 'tabbable';
import { useBodyScrollLock } from '../../app/useBodyScrollLock';

export const useGraphFullscreen = () => {
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  useBodyScrollLock(fullscreen);

  useLayoutEffect(() => {
    if (!fullscreen) return;
    const background: { element: Element; inert: string | null }[] = [];
    // Body portals remain available for the task drawer above the graph.
    let current: Element = containerRef.current!;
    while (current.parentElement !== null && current.parentElement !== document.body) {
      for (const sibling of current.parentElement.children) {
        if (sibling === current) continue;
        background.push({ element: sibling, inert: sibling.getAttribute('inert') });
        sibling.setAttribute('inert', '');
      }
      current = current.parentElement;
    }
    toggleRef.current!.focus();
    return () => {
      for (const { element, inert } of background) {
        if (inert === null) element.removeAttribute('inert');
        else element.setAttribute('inert', inert);
      }
    };
  }, [fullscreen]);

  const exit = () => {
    setFullscreen(false);
    toggleRef.current!.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!fullscreen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      exit();
    } else if (event.key === 'Tab') {
      const buttons = tabbable(containerRef.current!);
      const first = buttons[0]!;
      const last = buttons[buttons.length - 1]!;
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    }
  };

  return { fullscreen, containerRef, toggleRef, onKeyDown, toggle: () => { if (fullscreen) exit(); else setFullscreen(true); } };
};
