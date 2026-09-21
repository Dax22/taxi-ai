import type { Envelope, Mode } from './mobile-contracts.mjs';
import type { BookingRide } from './mobile-booking.mjs';
import type { VehicleCategoryId } from './vehicle-categories.mjs';
export type JourneyAction = 'claim' | 'propose' | 'accept' | 'confirm' | 'depart' | 'arrive' | 'start' | 'complete' | 'cancel';
export interface JourneyData { expectedVersion: number; amountKobo?: number; offerId?: string; pickupPin?: string; deliveryPin?: string; reason?: string }
export interface Journey extends BookingRide { mode: Mode; customerName: string; chatReady: boolean; pickupPin: string | null; pinBlockedUntil: number | null;
 offer: { id: string; amountKobo: number; fromYou: boolean; expiresAt: number } | null; allowedActions: JourneyAction[] }
export interface JourneyResult extends Envelope { ride: Journey }
export interface Position { lat: number; lng: number; accuracy: number; capturedAt: number }
export type OnlineData = { mode: 'gps'; position: Position } | { mode: 'sample'; areaId: string };
export interface Availability { id: string; online: boolean; owned: boolean; mode: 'gps' | 'sample'; areaId: string | null; sequence: number; updatedAt: number; expiresAt: number | null; reason: string | null }
export interface AvailabilityResult extends Envelope { availability: Availability | null }
export interface AvailableJob { id: string; version: number; vehicleCategory: VehicleCategoryId; pickup: string; destination: string; suggestedFareKobo: number; expiresAt: number; approximateDistanceKm: number | null }
export interface Work extends AvailabilityResult { settings: { allowSimulation: boolean; heartbeatSeconds: number; leaseSeconds: number; freshPositionSeconds: number };
 areas: { id: string; name: string }[]; current: Journey[]; activeElsewhere: { id: string; mode: Mode; status: string }[]; available: AvailableJob[] }
export interface Message { id: string; sequence: number; body: string; createdAt: number; fromYou: boolean }
export interface Thread extends Envelope { rideId: string; messages: Message[]; hasMore: boolean; nextAfter: number; lastSequence: number; readThrough: number; unread: number; reportedMessageIds: string[]; canSend: boolean }
export interface SentMessage extends Envelope { message: Message }
export interface Notification { id: number; rideId: string; mode: Mode; kind: string; title: string; createdAt: number; readAt: number | null }
export interface Notifications extends Envelope { notifications: Notification[]; unread: number; nextBefore: number | null; push: { enabled: boolean; projectId: string | null; registered: boolean } }
export interface NotificationTarget extends Envelope { target: { rideId: string; mode: Mode; screen: 'work' | 'journey' } }
export function parseJourney(value: unknown): JourneyResult;
export function parseAvailability(value: unknown): AvailabilityResult;
export function parseWork(value: unknown): Work;
export function parseThread(value: unknown): Thread;
export function parseSentMessage(value: unknown): SentMessage;
export function parseNotifications(value: unknown): Notifications;
export function parseNotificationTarget(value: unknown): NotificationTarget;

export function parseReadMessages(value: unknown): Envelope & { readThrough: number; unread: number };
