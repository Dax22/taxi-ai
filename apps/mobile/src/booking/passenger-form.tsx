import { Pressable } from 'react-native';
import type { BookingController, PassengerDraft } from './controller';
import { Text } from '../ui/typography';
import { Card, Field, styles } from '../ui/components';
import { SelectField } from '../ui/select-field';

export function PassengerForm({ passenger, controller, disabled }: { passenger: PassengerDraft; controller: BookingController; disabled: boolean }) {
  return <Card>
    <SelectField label="Who is riding?" value={passenger.kind} options={[{ value: 'self', label: 'Me' }, { value: 'guest', label: 'Someone else' }]} disabled={disabled} onChange={(kind) => controller.choosePassenger(kind as PassengerDraft['kind'])}/>
    {passenger.kind === 'guest' && <>
      <Field label="Passenger’s name" value={passenger.name} onChangeText={(value) => controller.editPassenger('name', value)} editable={!disabled} maxLength={80} autoComplete="off" placeholder="Who should the driver meet?"/>
      <Field label="Passenger’s phone number" value={passenger.phone} onChangeText={(value) => controller.editPassenger('phone', value)} editable={!disabled} maxLength={24} keyboardType="phone-pad" autoComplete="off" placeholder="080… or +234…"/>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: passenger.consent, disabled }} accessibilityLabel="The passenger is an adult and agrees to this booking and sharing their details for the ride" disabled={disabled} onPress={() => controller.consentPassenger(!passenger.consent)} style={[styles.secondary, { minHeight: 48, padding: 14, borderRadius: 12, opacity: disabled ? 0.55 : 1 }]}>
        <Text style={styles.body}>{passenger.consent ? '☑' : '☐'} The passenger is an adult and agrees to this booking and sharing their details for the ride.</Text>
      </Pressable>
      <Text style={styles.small}>You manage fare offers, explicitly accept the fare and confirm the booking. You remain responsible for payment. The driver sees the passenger’s name, not their phone number.</Text>
      <Text style={styles.small}>After confirmation, share a private trip link with your passenger. No SMS is sent automatically. This preview collects no payment.</Text>
    </>}
  </Card>;
}
