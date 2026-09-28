import type { DocumentKind, DriverOnboarding } from './mobile-contracts.mjs';
export const DRIVER_DOCUMENTS: Readonly<Record<DocumentKind, Readonly<{ label: string; expires: boolean }>>>;
export const DRIVER_REVIEW_CHECKS: Readonly<Record<string, string>>;
export const DRIVER_APPLICATION_LABELS: Readonly<Record<DriverOnboarding['status'], string>>;
export const MAX_DRIVER_FILE_BYTES: number;
export function driverDocumentDeadline(value: unknown): number | null;
