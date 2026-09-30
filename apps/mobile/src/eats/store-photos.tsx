import { useEffect, useRef, useState } from 'react';
import type { FoodPhotoAsset, FoodStore } from '../../../../packages/shared/src/eats.mjs';
import type { EatsController } from '../../../../packages/shared/src/eats-controller.mjs';
import { Text } from '../ui/typography';
import { Button, Card, Notice, styles } from '../ui/components';
import { chooseDishPhoto } from './photo';
import type { MealPhoto } from './photo-file';
import { FoodPhoto } from './discovery';
import { FoodPhotoGuidance, FoodPhotoReview, SelectedFoodPhoto } from './photo-fields';

type Purpose = 'logo' | 'cover' | 'menu_reference';

function StorePhotoSlot({ store, asset, purpose, controller, locked }: { store: FoodStore; asset?: FoodPhotoAsset | null; purpose: Purpose; controller: EatsController; locked: boolean }) {
  const [selection, setSelection] = useState<{ photo: MealPhoto; version: number } | null>(null), [choosing, setChoosing] = useState(false), [error, setError] = useState('');
  const operation = useRef(0);
  useEffect(() => () => { operation.current++; }, []);
  const title = purpose === 'menu_reference' ? 'Private printed-menu reference' : purpose === 'logo' ? 'Kitchen logo' : 'Kitchen cover photo';
  const stale = Boolean(selection && selection.version !== store.version), disabled = locked || choosing;
  async function choose(camera: boolean) {
    if (disabled) return;
    const current = ++operation.current, version = store.version;
    setChoosing(true); setError('');
    try { const photo = await chooseDishPhoto(camera); if (current === operation.current && photo) setSelection({ photo, version }); }
    catch (e) { if (current === operation.current) setError(e instanceof Error ? e.message : 'Could not read that image.'); }
    finally { if (current === operation.current) setChoosing(false); }
  }
  async function save(image: MealPhoto | null) {
    setError('');
    if (await controller.storeAction('assets', { expectedVersion: selection?.version ?? store.version, purpose, image })) setSelection(null);
  }
  return <Card>
    <Text style={styles.h2}>{title}</Text><Notice message={error}/>
    <FoodPhotoGuidance kind={purpose === 'menu_reference' ? 'menu' : 'brand'}/>
    {selection ? <><SelectedFoodPhoto photo={selection.photo} label={title}/><Text style={styles.small}>Selected image. Save to {purpose === 'menu_reference' ? 'attach it privately' : 'submit it for review'}.</Text></>
      : asset ? <><FoodPhoto id={asset.id} revision={asset.version} controller={controller} label={title} compact contain={purpose !== 'cover'}/><FoodPhotoReview status={asset.status} note={asset.reviewNote}/></>
        : <Text style={styles.body}>No {purpose === 'menu_reference' ? 'printed-menu reference' : purpose === 'logo' ? 'logo' : 'cover photo'} added.</Text>}
    {stale && <Notice message="Your kitchen changed while this image was selected. Discard it and choose it again before saving."/>}
    <Button title={`Choose ${purpose === 'menu_reference' ? 'menu image' : purpose === 'logo' ? 'logo' : 'cover photo'}`} secondary busy={choosing} disabled={disabled} onPress={() => void choose(false)}/>
    <Button title={`Take ${purpose === 'menu_reference' ? 'menu' : purpose === 'logo' ? 'logo' : 'cover'} photo`} secondary disabled={disabled} onPress={() => void choose(true)}/>
    {selection && <><Button title={purpose === 'menu_reference' ? 'Save private reference' : 'Submit image for review'} disabled={disabled || stale} onPress={() => void save(selection.photo)}/><Button title="Discard selected image" secondary disabled={disabled} onPress={() => { setSelection(null); setError(''); }}/></>}
    {!selection && asset && <Button title={`Remove ${purpose === 'menu_reference' ? 'private reference' : purpose === 'logo' ? 'logo' : 'cover photo'}`} secondary disabled={disabled} onPress={() => void save(null)}/>}
  </Card>;
}

export function StorePhotos({ store, controller, locked }: { store: FoodStore; controller: EatsController; locked: boolean }) {
  return <>
    <StorePhotoSlot store={store} asset={store.assets?.logo} purpose="logo" controller={controller} locked={locked}/>
    <StorePhotoSlot store={store} asset={store.assets?.cover} purpose="cover" controller={controller} locked={locked}/>
    <StorePhotoSlot store={store} asset={store.assets?.menuReference} purpose="menu_reference" controller={controller} locked={locked}/>
  </>;
}
