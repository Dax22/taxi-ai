export const DRIVER_FACE_CONSENT_VERSION: 'driver-face-match-v2';
export const DRIVER_FACE_CONSENT: string;
type FaceCheck = { available: boolean; status: string; reason?: string | null; checkedAt?: number | null };
export function driverFaceCheckComplete(check?: FaceCheck | null): boolean;
export function driverFacePresentation(check?: FaceCheck | null): { title: string; detail: string };
