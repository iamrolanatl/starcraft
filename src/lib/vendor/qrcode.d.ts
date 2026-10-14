declare const qrcode: (typeNumber: number, errorCorrectionLevel: "L" | "M" | "Q" | "H") => { addData(d: string): void; make(): void; createSvgTag(opts?: { cellSize?: number; margin?: number; scalable?: boolean }): string };
export default qrcode;
