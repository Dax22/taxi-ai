import type { VehicleCategoryId } from './vehicle-categories.mjs';
import type { Vehicle } from './mobile-contracts.mjs';
export type PassengerDetails = { kind: 'self' } | { kind: 'guest'; name: string; phone: string; consent: true };
export type PassengerView = { kind: 'self'; name?: string } | { kind: 'guest'; name: string; phone?: string };
export interface GuestLink { id: string; version: number; active: boolean; expiresAt: number }
export interface GuestView { rideId: string; canCreate: boolean; link: GuestLink | null }
export interface GuestResponse { guest: GuestView; token?: string; replayed?: boolean; serverNow?: number }
export interface GuestTripResponse { mode: 'preview'; expiresAt: number; serverNow?: number; guestTrip: { reference: string; status: string; passengerName: string;
  bookerName: string; pickup: string; destination: string; driver: { name: string; vehicle: Vehicle }; pickupPin: string | null;
  location: { lat: number; lng: number; accuracy: number; capturedAt: number; source: 'driver_shared'; stale: boolean } | null } }
export function guestPhone(value: unknown): string;
export function passengerDetails(value: unknown, vehicleCategory?: VehicleCategoryId): PassengerDetails;
export function passengerView(snapshot: unknown, options?: { isBooker?: boolean; bookerName?: string }): PassengerView;
export function readPassenger(value: unknown, vehicleCategory?: VehicleCategoryId, options?: { allowPhone?: boolean }): PassengerView | undefined;
export function readGuestResponse(value: unknown, rideId?: string): GuestResponse;
export function readGuestTripResponse(value: unknown): GuestTripResponse;
