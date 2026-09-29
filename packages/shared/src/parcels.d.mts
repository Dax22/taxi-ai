import type { Vehicle } from './mobile-contracts.mjs';

export interface ParcelInvitationLink { id: string; version: number; active: boolean; expiresAt: number; claimed: boolean }
export interface ParcelInvitation { rideId: string; canCreate: boolean; link: ParcelInvitationLink | null }
export interface ParcelEnvelope { apiVersion?: 1; serverNow?: number }
export interface ParcelInvitationResponse extends ParcelEnvelope { invitation: ParcelInvitation; token?: string; replayed?: boolean }
export interface ParcelSnapshot {
  rideId: string;
  reference: string;
  status: 'requested' | 'negotiating' | 'agreed' | 'booked' | 'on_way' | 'arrived' | 'in_progress' | 'completed' | 'cancelled' | 'expired';
  description: string;
  weightKg: number;
  recipientName: string;
  destination: string;
  driver: { name: string; vehicle: Vehicle } | null;
  location: { lat: number; lng: number; accuracy: number; capturedAt: number; source: 'driver_shared'; stale: false } | null;
  dropoffPin: string | null;
  verifiedAt: number | null;
  updatedAt: number;
}
export interface ParcelResponse extends ParcelEnvelope { parcel: ParcelSnapshot; replayed?: boolean }
export interface ReceivedParcelsResponse extends ParcelEnvelope { parcels: ParcelSnapshot[] }
export function readParcelInvitationResponse(value: unknown, rideId?: string): ParcelInvitationResponse;
export function readParcelSnapshot(value: unknown, rideId?: string): ParcelSnapshot;
export function readParcelResponse(value: unknown, rideId?: string): ParcelResponse;
export function readReceivedParcelsResponse(value: unknown): ReceivedParcelsResponse;
