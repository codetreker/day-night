import type { CanvasPoint } from './layout';

export const DEPENDENCY_DASH_ARRAY = '5 4';
export const DEPENDENCY_DASH_PERIOD = 9;

export type DashPiece = { readonly startDistance: number } & (
  | { readonly kind: 'line'; readonly from: CanvasPoint; readonly length: number; readonly cosine: number; readonly sine: number }
  | { readonly kind: 'path'; readonly d: string }
);
