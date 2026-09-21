import type { Envelope, Vehicle } from './mobile-contracts.mjs';
export interface Place { name: string; lat: number; lng: number }
export interface RouteGeometry { distanceMeters: number; durationSeconds: number; coordinates: [number, number][] }
export type RequestData = { quoteId: string } | { pickupId: string; destinationId: string };
export interface BookingPreview { kind: 'route' | 'sample'; pickup: string; destination: string; suggestedFareKobo: number;
  expiresAt: number | null; request: RequestData; route: RouteGeometry | null }
export interface BookingRide { id: string; version: number; status: string; pickup: string; destination: string;
  suggestedFareKobo: number; fareKobo: number | null; expiresAt: number | null; canCancel: boolean;
  driver: { name: string; vehicle: Vehicle } | null }
export interface Booking extends Envelope { online: { enabled: boolean; searchHost: string | null; routeHost: string | null };
  allowSample: boolean; areas: { id: string; name: string }[]; current: BookingRide[]; blockedBy: 'work' | 'online' | null }
export interface PlacesResult extends Envelope { places: Place[]; attribution: string }
export interface PreviewResult extends Envelope { preview: BookingPreview }
export interface BookingRideResult extends Envelope { ride: BookingRide }
export function isRequestOpen(status: string): boolean;
export function bookingStatusLabel(status: string): string;
export function parseBooking(value: unknown): Booking;
export function parsePlaces(value: unknown): PlacesResult;
export function parsePreview(value: unknown): PreviewResult;
export function parseBookingRide(value: unknown): BookingRideResult;
