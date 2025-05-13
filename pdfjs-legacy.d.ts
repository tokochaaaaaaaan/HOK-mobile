// pdfjs-legacy.d.ts

// pdf.js 本体
declare module "pdfjs-dist/legacy/build/pdf" {
    import type { PDFDocumentProxy } from "pdfjs-dist";
    export const GlobalWorkerOptions: { workerSrc: string };
    export function getDocument(
      source: string | Uint8Array | { data: ArrayBuffer }
    ): { promise: Promise<PDFDocumentProxy> };
  }
  
  // pdf.js のワーカー用エントリポイント
  declare module "pdfjs-dist/legacy/build/pdf.worker.entry" {
    const content: string;
    export default content;
  }
  