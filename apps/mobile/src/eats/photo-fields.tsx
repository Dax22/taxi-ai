import { useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { Text } from '../ui/typography';
import { Notice, styles } from '../ui/components';
import { discovery } from './discovery';
import type { MealPhoto } from './photo-file';

export function SelectedFoodPhoto({ photo, label }: { photo: MealPhoto; label: string }) {
  const [failed, setFailed] = useState<MealPhoto | null>(null);
  const current = useRef(photo); current.current = photo;
  return failed === photo ? <Notice message="This photo preview could not be displayed. Choose another photo if needed."/>
    : <Image source={{ uri: `data:${photo.mimeType};base64,${photo.base64}` }} style={discovery.mealPhoto} resizeMode="contain" accessibilityLabel={`${label} · selected photo, not yet saved`} onError={() => { if (current.current === photo) setFailed(photo); }}/>;
}

export function FoodPhotoReview({ status, note }: { status?: string | null; note?: string | null }) {
  if (!status || !['pending', 'rejected', 'private', 'approved', 'legacy-approved'].includes(status)) return null;
  return <View style={styles.stack}>
    <Text style={styles.small}>{status === 'pending' ? 'Photo awaiting review. It will appear on your public listing only after approval.'
      : status === 'rejected' ? 'Photo was not approved. Replace it with a suitable photo or remove it.'
        : status === 'private' ? 'Private menu reference · visible only to your kitchen account.'
          : status === 'legacy-approved' ? 'Existing photo retained; not yet reviewed under the new photo policy.' : 'Photo approved for your listing.'}</Text>
    {status === 'rejected' && !!note && <Notice message={note}/>}
  </View>;
}

export function FoodPhotoGuidance({ kind = 'dish' }: { kind?: 'dish' | 'brand' | 'menu' }) {
  return <Text style={styles.small}>{kind === 'dish'
    ? 'Photos are optional. Use your own real dish, showing the portion and sides included in the price. Avoid stock or AI-generated dish photos.'
    : kind === 'brand' ? 'Photos are optional. Use your own logo or a truthful cover photo for your kitchen.'
      : 'Optional: photograph your printed menu as a private reference. Add each dish and any separately sold extras with their price, portion and availability in Your menu. This image does not create dishes or become a public listing.'}
    {' '}Upload only images you own or have permission to use. Keep people, phone numbers, street addresses and private details out of photos. Images are resized and compressed, and location metadata is removed. Public photos require review.</Text>;
}
