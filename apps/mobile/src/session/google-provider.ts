import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

const validId = (id: string | undefined) => !!id && /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(id);
export function googleAvailable() {
  return Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
    && ['ios', 'android'].includes(Platform.OS) && validId(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID)
    && (Platform.OS !== 'ios' || validId(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID));
}

/** The only lazy native adapter: Expo Go has no Google native module. Loading it
 * only on an explicit tap preserves the existing email preview in Expo Go. */
export async function chooseGoogleIdentity(challenge: { nonce: string; webClientId: string }): Promise<string | null> {
  if (!googleAvailable() || challenge.webClientId !== process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) {
    throw new Error('Google sign-in needs a configured development build. Use your Taxi Ai password for this preview.');
  }
  try {
    const { GoogleOneTapSignIn: google, isCancelledResponse, isSuccessResponse } = await import('react-native-nitro-google-signin');
    google.configure({ webClientId: challenge.webClientId, iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
      nonce: challenge.nonce, offlineAccess: false, autoSelectOnSignIn: false });
    if (Platform.OS === 'android') await google.checkPlayServices();
    // Always present a fresh account selection for the server-issued nonce.
    await google.signOut();
    try {
      const result = await google.presentExplicitSignIn();
      if (isCancelledResponse(result)) return null;
      if (!isSuccessResponse(result) || !result.data.idToken) throw new Error('No Google identity returned.');
      return result.data.idToken;
    } finally { await google.signOut().catch(() => {}); }
  } catch {
    // SDK exceptions can contain identity details. Show a bounded product message.
    throw new Error('Google sign-in could not finish. Try again or use your Taxi Ai password.');
  }
}
