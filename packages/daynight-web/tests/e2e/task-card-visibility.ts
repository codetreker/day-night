export const observeGraphCardVisibility = (button: HTMLElement) => {
  const card = button.parentElement!;
  const canvas = button.closest<HTMLElement>('.task-graph-canvas')!;
  const rect = (element: HTMLElement) => {
    const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
    return { left, top, right, bottom, width, height };
  };
  const buttonBounds = rect(button); const cardBounds = rect(card); const canvasBounds = rect(canvas);
  const windowBounds = { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: document.documentElement.clientHeight };
  const failures: string[] = [];
  const checkBounds = (label: string, bounds: typeof buttonBounds, clip: typeof windowBounds, x = true, y = true) => {
    if (bounds.width <= 0 || bounds.height <= 0 || !Object.values(bounds).every(Number.isFinite)
      || x && (bounds.left < clip.left || bounds.right > clip.right) || y && (bounds.top < clip.top || bounds.bottom > clip.bottom)) failures.push(label);
  };
  for (const [label, bounds] of [['card', cardBounds], ['body', buttonBounds]] as const) {
    checkBounds(`${label} outside document viewport`, bounds, windowBounds);
    checkBounds(`${label} outside graph canvas`, bounds, canvasBounds);
  }
  const style = getComputedStyle(button); const cardStyle = getComputedStyle(card);
  const supportedClipStyle = (css: CSSStyleDeclaration) => css.clip === 'auto' && css.clipPath === 'none' && css.contain === 'none';
  const localClipStyles = { body: { clip: style.clip, clipPath: style.clipPath, contain: style.contain },
    card: { clip: cardStyle.clip, clipPath: cardStyle.clipPath, contain: cardStyle.contain } };
  if (!supportedClipStyle(style) || !supportedClipStyle(cardStyle)) failures.push('unsupported card or body clipping geometry');
  const cssSizes = { bodyWidth: Number.parseFloat(style.width), bodyHeight: Number.parseFloat(style.height),
    cardWidth: Number.parseFloat(cardStyle.width), cardHeight: Number.parseFloat(cardStyle.height) };
  const cardClient = { width: cssSizes.cardWidth - Number.parseFloat(cardStyle.borderLeftWidth) - Number.parseFloat(cardStyle.borderRightWidth),
    height: cssSizes.cardHeight - Number.parseFloat(cardStyle.borderTopWidth) - Number.parseFloat(cardStyle.borderBottomWidth) };
  const zeroMargins = [style.marginLeft, style.marginRight, style.marginTop, style.marginBottom].every((value) => value === '0px');
  const zeroPadding = [cardStyle.paddingLeft, cardStyle.paddingRight, cardStyle.paddingTop, cardStyle.paddingBottom].every((value) => value === '0px');
  const localContract = style.boxSizing === 'border-box' && cardStyle.boxSizing === 'border-box'
    && Object.values(cssSizes).every(Number.isSafeInteger) && cssSizes.bodyWidth === button.offsetWidth && cssSizes.bodyHeight === button.offsetHeight
    && cssSizes.cardWidth === card.offsetWidth && cssSizes.cardHeight === card.offsetHeight
    && cardClient.width === card.clientWidth && cardClient.height === card.clientHeight && cardStyle.overflowX === 'hidden' && cardStyle.overflowY === 'hidden'
    && style.position === 'static' && card.firstElementChild === button && button.offsetLeft === 0 && button.offsetTop === 0
    && zeroMargins && zeroPadding && cardStyle.display === 'flex' && cardStyle.flexDirection === 'column' && cardStyle.justifyContent === 'normal';
  const local = { left: button.offsetLeft - card.scrollLeft, top: button.offsetTop - card.scrollTop,
    width: button.offsetWidth, height: button.offsetHeight, clientWidth: card.clientWidth, clientHeight: card.clientHeight };
  if (!localContract || !card.matches('.task-node') || button.offsetParent !== card || style.transform !== 'none'
    || style.translate !== 'none' || style.rotate !== 'none' || style.scale !== 'none' || style.zoom !== '1'
    || local.left < 0 || local.top < 0 || local.width <= 0 || local.height <= 0
    || local.left + local.width > local.clientWidth || local.top + local.height > local.clientHeight) failures.push('body leaves its untransformed card client clip');
  const ancestors = [];
  for (let ancestor = card.parentElement; ancestor !== null; ancestor = ancestor.parentElement) {
    const css = getComputedStyle(ancestor); const bounds = rect(ancestor);
    const rootStyle = getComputedStyle(document.documentElement);
    const viewportOverflow = ancestor === document.documentElement || ancestor === document.body && rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible';
    const x = !viewportOverflow && css.overflowX !== 'visible'; const y = !viewportOverflow && css.overflowY !== 'visible';
    const clip = { left: bounds.left + Number.parseFloat(css.borderLeftWidth), top: bounds.top + Number.parseFloat(css.borderTopWidth),
      right: bounds.right - Number.parseFloat(css.borderRightWidth), bottom: bounds.bottom - Number.parseFloat(css.borderBottomWidth) };
    let untransformed = true;
    if (x || y || viewportOverflow) for (let outer: HTMLElement | null = ancestor; outer !== null; outer = outer.parentElement) {
      const outerStyle = getComputedStyle(outer);
      if (outerStyle.transform !== 'none' || outerStyle.translate !== 'none' || outerStyle.rotate !== 'none' || outerStyle.scale !== 'none' || outerStyle.zoom !== '1') untransformed = false;
    }
    const supported = (!x || css.overflowX === 'hidden') && (!y || css.overflowY === 'hidden') && (!(x || y) || css.scrollbarGutter === 'auto')
      && supportedClipStyle(css) && untransformed;
    ancestors.push({ className: ancestor.className, bounds, clip, overflowX: css.overflowX, overflowY: css.overflowY,
      transform: css.transform, clipPath: css.clipPath, contain: css.contain, scrollbarGutter: css.scrollbarGutter, viewportOverflow, untransformed, supported });
    if (!supported || !Object.values(clip).every(Number.isFinite)) failures.push(`unsupported clipping geometry: ${ancestor.className}`);
    if (x || y) for (const [label, target] of [['card', cardBounds], ['body', buttonBounds]] as const) checkBounds(`${label} outside ancestor clip: ${ancestor.className}`, target, clip, x, y);
  }
  return { failures, buttonBounds, cardBounds, canvasBounds, windowBounds, local, localClipStyles, cssSizes, cardClient, localContract, zeroMargins, zeroPadding,
    bodyPosition: style.position, cardLayout: { display: cardStyle.display, direction: cardStyle.flexDirection, justify: cardStyle.justifyContent }, offsetParentIsCard: button.offsetParent === card,
    bodyTransform: style.transform, ancestors, window: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY } };
};
