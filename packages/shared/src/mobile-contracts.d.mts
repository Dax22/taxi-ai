export const MOBILE_API_VERSION: 1;
export type Mode = 'customer' | 'work';
export interface Eligibility { eligible: boolean; missing: string[]; expired: string[] }
export interface Vehicle { model: string; plate: string }
export interface Account { id: string; name: string; email: string; capabilities: ('customer' | 'driver')[];
  driver: { status: string; vehicle: Vehicle; eligibility: Eligibility } | null }
export interface Credentials { sessionId: string; accessToken: string; refreshToken: string; accessExpiresAt: number; refreshExpiresAt: number }
export interface Envelope { apiVersion: 1; serverNow: number; [key: string]: unknown }
export interface SignIn extends Envelope { user: Account; credentials: Credentials }
export interface RideSummary { id: string; status: string; pickup: string; destination: string;
  fareKobo: number | null; suggestedFareKobo: number; createdAt: number; isDemo: boolean }
export interface Activity extends Envelope { current: RideSummary[]; history: RideSummary[];
  activeElsewhere: { id: string; mode: Mode; status: string }[]; nextBefore: string | null }
export interface Device { id: string; name: string; createdAt: number; refreshedAt: number; expiresAt: number; current: boolean }
export interface DriverApplication { status: string; eligibility: Eligibility; documentCount: number; vehicle: Vehicle }
export function envelope(value: unknown): Envelope;
export function parseAccount(value: unknown): Account;
export function parseSignIn(value: unknown): SignIn;
export function parseActivity(value: unknown): Activity;
export function parseDevices(value: unknown): Device[];
export function parseApplication(value: unknown): DriverApplication;
