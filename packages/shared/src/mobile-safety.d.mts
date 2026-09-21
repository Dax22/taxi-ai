export type SafetyKind = 'need_help' | 'possible_crash' | 'unsafe_behaviour' | 'other';
export type IncidentStatus = 'open' | 'acknowledged' | 'resolved';
export interface SafetyContact { id: string; name: string; phone: string; version: number; verified: false }
export interface SafetyShare { id: string; rideId: string; active: boolean; version: number; createdAt: number; expiresAt: number }
export interface SafetyLocation { lat: number; lng: number; accuracy: number; capturedAt: number; stale: boolean; source: 'driver_shared' }
export interface SafetyIncident {
  id: string; rideId: string; kind: SafetyKind; status: IncidentStatus; version: number; note: string;
  createdAt: number; updatedAt: number; driverName: string; vehiclePlate: string; location: SafetyLocation | null;
  events: { action: 'created' | 'acknowledged' | 'resolved'; note: string; createdAt: number }[];
  notifications: { id: string; recipientName: string; recipientPhone: string; mode: 'simulation'; status: 'queued' | 'sent' | 'delivered' | 'failed' | 'cancelled'; attempts: number; updatedAt: number }[];
}
export interface SafetyEnvelope { mode: 'simulation'; viewerId: string; serverNow: number }
export interface SafetyContacts extends SafetyEnvelope { contacts: SafetyContact[] }
export interface TripSafety extends SafetyEnvelope { rideId: string; canRaise: boolean; incidents: SafetyIncident[]; share: SafetyShare | null; location: SafetyLocation | null }
export interface SafetyMutation extends SafetyEnvelope { replayed: boolean; contact?: SafetyContact | null; incident?: SafetyIncident; share?: SafetyShare | null; token?: string | null }
export type SafetyCommand =
  | { action: 'contact.add'; data: { name: string; phone: string } }
  | { action: 'contact.edit'; id: string; data: { name: string; phone: string; expectedVersion: number } }
  | { action: 'contact.remove'; id: string; data: { expectedVersion: number } }
  | { action: 'incident.create'; id: string; data: { kind: SafetyKind; note: string; contactIds: string[]; contactVersions: Record<string, number> } }
  | { action: 'link.create'; id: string; data: { minutes: number; expectedShareId: string | null } }
  | { action: 'link.revoke'; id: string; data: { expectedVersion: number } };
export const SAFETY_PREVIEW_NOTICE: string;
export const SAFETY_OPTIONS: readonly { readonly id: SafetyKind; readonly label: string }[];
export const SAFETY_SHARE_MINUTES: readonly number[];
export function safetyId(value: unknown): value is string;
export function parseSafetyContacts(body: unknown): SafetyContacts;
export function parseTripSafety(body: unknown): TripSafety;
export function parseSafetyMutation(body: unknown): SafetyMutation;
export function safetyCommandPath(command: SafetyCommand): string;
export function safetyLocationLabel(value: SafetyLocation | null, now: number): string;
