import { View, StyleSheet } from 'react-native';
import { Text } from '../ui/typography';
import { router } from 'expo-router';
import { EATS_STATUS } from '../../../../packages/shared/src/eats.mjs';
import type { FoodOrder, FoodTotals } from '../../../../packages/shared/src/eats.mjs';
import type { EatsState, EatsController } from '../../../../packages/shared/src/eats-controller.mjs';
import { Button, Card, Loading, Notice, Pill, colors, fare, styles } from '../ui/components';
export function FoodFeedback({ state, controller }: { state: EatsState; controller: EatsController }) {
  async function retry() {
    if (await controller.retry()) {
      const next = controller.snapshot();
      if (next.screen === 'order' && next.orderId) router.navigate({ pathname: '/food-order', params: { id: next.orderId } });
    }
  }
  return <><Notice message={state.error}/>{!!state.notice && <Text style={styles.body} accessibilityLiveRegion="polite">{state.notice}</Text>}{state.loading && <Loading/>}
    {state.uncertain && <Card><Text style={styles.h2}>Confirm the pending action.</Text><Text style={styles.body}>The connection was interrupted. Retry the same action to check its result before changing this order.</Text><Button title="Retry the same action" busy={state.busy} onPress={() => void retry()}/></Card>}</>;
}
export function FoodPreview() { return <Text style={styles.small}>Development preview · fictional menus and test orders. No payment is collected or live delivery dispatched.</Text>; }
export function FoodMoney({ value }: { value: FoodTotals }) {
  return <View style={styles.stack}>{([['Food subtotal', value.subtotalKobo], ['Delivery', value.deliveryFeeKobo], ['Service fee · 5%, capped at ₦1,000', value.serviceFeeKobo], ['Order total', value.totalKobo]] as const).map(([label, amount]) => <View key={label} style={food.money}><Text style={[styles.body, food.moneyLabel]}>{label}</Text><Text style={label === 'Order total' ? styles.h2 : styles.body}>{fare(amount)}</Text></View>)}</View>;
}
export function FoodOrders({ orders, empty = 'No food orders yet.' }: { orders: FoodOrder[]; empty?: string }) {
  return <>{!orders.length && <Text style={styles.body}>{empty}</Text>}{orders.map((o) => <Card key={o.id}><Pill>{EATS_STATUS[o.status].toUpperCase()}</Pill><Text style={styles.h2}>{o.restaurant.name}</Text><Text style={styles.body}>{o.fulfillment === 'pickup' ? 'Customer pickup · ' : 'Delivery · '}{o.lines.reduce((n, i) => n + i.quantity, 0)} items · {fare(o.totals.totalKobo)}</Text><Text style={styles.small}>{new Date(o.createdAt).toLocaleString()}</Text><Button title="Open food order" secondary onPress={() => router.push({ pathname: '/food-order', params: { id: o.id } })}/></Card>)}</>;
}
export const food = StyleSheet.create({
  hero: { padding: 24, backgroundColor: colors.yellow, borderRadius: 26, gap: 14 },
  cover: { borderRadius: 16, minHeight: 110, alignItems: 'center', justifyContent: 'center' }, symbol: { fontSize: 60 },
  menuRow: { borderBottomColor: colors.border, borderBottomWidth: 1, paddingVertical: 18, gap: 12 },
  quantity: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 12 },
  money: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'space-between', alignItems: 'center' }, moneyLabel: { flexShrink: 1 },
  pin: { fontSize: 32, letterSpacing: 5, fontWeight: '700', color: colors.ink },
  timeline: { borderLeftWidth: 3, borderLeftColor: colors.yellow, paddingLeft: 16, paddingBottom: 18, gap: 6 },
});
