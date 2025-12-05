declare module 'bwip-js' {
  export interface BarcodeOptions {
    bcid: string;
    text: string;
    scale?: number;
    height?: number;
    includetext?: boolean;
    textxalign?: string;
  }

  export function toCanvas(
    canvas: HTMLCanvasElement,
    options: BarcodeOptions
  ): void;
}
