export const longConfirmationPath = Array.from({ length: 4 }, (_, index) => {
  const prefix = `z${index}-`;
  const suffix = index === 3 ? '-path-tail-visible.txt' : '';
  return `${prefix}${'x'.repeat(180 - prefix.length - suffix.length)}${suffix}`;
}).join('/');
