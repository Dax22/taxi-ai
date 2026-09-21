import { Share } from 'react-native';

/** User-selected OS sharing only. A successful dialog is not proof of delivery. */
export async function shareTripLink(url: string): Promise<void> {
  await Share.share({ title: 'Taxi Ai private test-trip link', message:
    `Private Taxi Ai test-trip link. Anyone with it can see the driver, vehicle plate, route and available shared location until it ends. It is not an emergency alert. Preview access may be required.\n${url}` },
  { dialogTitle: 'Share a private test-trip link' });
}
