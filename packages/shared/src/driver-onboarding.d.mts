export type DocumentKind = 'profile_photo' | 'driving_licence' | 'vehicle_registration' | 'insurance' | 'vehicle_photo';
export const DRIVER_DOCUMENTS: Readonly<Record<DocumentKind, Readonly<{ label: string; expires: boolean; required: boolean }>>>;
export const DRIVER_REQUIRED_DOCUMENTS: readonly DocumentKind[];
export const DRIVER_REVIEW_CHECKS: Readonly<Record<'identity' | 'licence' | 'vehicle', string>>;
export const DRIVER_APPLICATION_LABELS: Readonly<Record<string, string>>;
export const MAX_DRIVER_FILE_BYTES: number;
export function driverDocumentDeadline(value: unknown): number | null;
