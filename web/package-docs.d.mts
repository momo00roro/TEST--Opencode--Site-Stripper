export function buildDocumentationFiles(
  analysis: Record<string, any>,
  screenshotFiles?: Record<string, Uint8Array>,
): { files: Record<string, string>; byteLength: number; screenshotManifest: Record<string, any> };

export function validateDocumentationPackage(
  files: Record<string, string>,
  screenshotFiles?: Record<string, Uint8Array>,
): string[];
