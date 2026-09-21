export const MOBILE_API_VERSION: 1;
export type Mode = 'customer' | 'work';
export interface Eligibility { eligible: boolean; missing: string[]; expired: string[] }
export interface Vehicle { model: string; plate: string; make?: string; modelName?: string; year?: number; colour?: string }
export interface Account { id: string; name: string; email: string; emailVerified?: boolean; capabilities: ('customer' | 'driver')[];
  driver: { status: string; vehicle: Vehicle; eligibility: Eligibility } | null }
export interface Credentials { sessionId: string; accessToken: string; refreshToken: string; accessExpiresAt: number; refreshExpiresAt: number }
export interface Envelope { apiVersion: 1; serverNow: number; [key: string]: unknown }
export interface SignIn extends Envelope { user: Account; credentials: Credentials }
export interface RideSummary { id: string; status: string; pickup: string; destination: string;
  fareKobo: number | null; suggestedFareKobo: number; createdAt: number; isDemo: boolean;
  driver?: { id: string; name: string; vehicle: Vehicle } | null }
export interface Activity extends Envelope { current: RideSummary[]; history: RideSummary[];
  activeElsewhere: { id: string; mode: Mode; status: string }[]; nextBefore: string | null }
export interface Device { id: string; name: string; createdAt: number; refreshedAt: number; expiresAt: number; current: boolean }
export interface DriverApplication { status: string; eligibility: Eligibility; documentCount: number; vehicle: Vehicle }
export type DocumentKind = 'profile_photo' | 'driving_licence' | 'vehicle_registration' | 'insurance' | 'vehicle_photo';
export interface DriverDetails { legalName: string; phone: string; licenceNumber: string;
  vehicle: { make: string; model: string; year: number; colour: string; plate: string } }
export interface DriverDocument { id: string; kind: DocumentKind; name: string; mimeType: 'image/png' | 'image/jpeg'; sizeBytes: number; expiresOn: string | null }
export interface DriverOnboarding { driverId: string; status: 'draft' | 'submitted' | 'changes_requested' | 'rejected' | 'approved';
  version: number; details: DriverDetails | null; documents: DriverDocument[]; busy: boolean;
  eligibility: Eligibility; reviewReason: string | null; vehicle: Vehicle }
export interface DriverCommands {
  save: { expectedVersion: number; details: DriverDetails };
  upload: { expectedVersion: number; kind: DocumentKind; name: string; mimeType: 'image/png' | 'image/jpeg'; base64: string; expiresOn: string | null };
  remove: { expectedVersion: number; documentId: string };
  submit: { expectedVersion: number };
  reopen: { expectedVersion: number };
}
export function envelope(value: unknown): Envelope;
export function parseVehicle(value: unknown): Vehicle;
export function parseAccount(value: unknown): Account;
export interface EmailStatus { enabled: boolean; verified: boolean; email: string }
export function parseEmailStatus(value: unknown): EmailStatus;
export function parseSignIn(value: unknown): SignIn;
export function parseActivity(value: unknown): Activity;
export function parseDevices(value: unknown): Device[];
export function parseApplication(value: unknown): DriverApplication;
export function parseOnboarding(value: unknown): DriverOnboarding;
