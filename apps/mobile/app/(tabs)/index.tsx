import { Redirect, router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../../src/ui/typography';
import { useSession } from '../../src/session/provider';
import { Button, Logo, Notice, Pill, colors, styles } from '../../src/ui/components';
import { MapScaffold } from '../../src/maps/map-scaffold';
import { useDeviceMapPosition } from '../../src/maps/device-position';

function QuickAction({ title, subtitle, onPress }: { title: string; subtitle: string; onPress(): void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${subtitle}`} onPress={onPress}
    style={({ pressed }) => [look.quick, { opacity: pressed ? .72 : 1 }]}>
    <Text style={look.quickTitle}>{title}</Text><Text style={look.quickText}>{subtitle}</Text>
  </Pressable>;
}
export default function CustomerHome() {
  const { user, role } = useSession(), location = useDeviceMapPosition();
  if (role === 'driver') return <Redirect href="/work"/>;
  const firstName = user?.name.split(' ')[0] ?? 'there', position = location.position;
  const pins = position ? [{ id: 'me', lat: position.lat, lng: position.lng, title: 'You are here',
    description: position.accuracy ? `Phone location · about ${Math.round(position.accuracy)} m accuracy` : 'Phone location' }] : [];
  return <MapScaffold pins={pins} center={position ?? undefined} mapLabel="Taxi Ai customer home map"
    top={<View style={look.brandBar}><View style={look.brandChip}><Logo/></View><Pressable accessibilityRole="button"
      accessibilityLabel="Open account" style={look.profileButton} onPress={() => router.push('/account')}><Text style={look.profileText}>{firstName.slice(0,1).toUpperCase()}</Text></Pressable></View>}
    floating={<Pressable accessibilityRole="button" accessibilityLabel="Centre map on my location" accessibilityState={{ busy: location.busy }}
      style={({ pressed }) => [look.locate, pressed && { opacity: .7 }]} onPress={() => void location.locate()}><Text style={look.locateText}>{location.busy ? '…' : '⌖'}</Text></Pressable>}>
    <View style={look.heading}><Pill>RIDE · EATS · COURIER</Pill><Text style={look.greeting}>Hi, {firstName}.</Text></View>
    <Pressable accessibilityRole="button" accessibilityLabel="Where are you going?" style={({ pressed }) => [look.destination, pressed && { transform:[{scale:.99}] }]}
      onPress={() => router.push({ pathname: '/book-ride', params: { category: 'standard' } })}>
      <View style={look.destinationDot}/><Text style={look.destinationText}>Where are you going?</Text><Text style={look.arrow}>›</Text>
    </Pressable>
    <Notice message={location.error}/>
    <View style={look.quickRow}>
      <QuickAction title="Ride" subtitle="Standard" onPress={() => router.push({ pathname: '/book-ride', params: { category: 'standard' } })}/>
      <QuickAction title="SUV" subtitle="More space" onPress={() => router.push({ pathname: '/book-ride', params: { category: 'suv' } })}/>
      <QuickAction title="Eats" subtitle="Food delivery" onPress={() => router.push('/eats')}/>
      <QuickAction title="Courier" subtitle="Send parcel" onPress={() => router.push({ pathname: '/book-ride', params: { category: 'motorcycle', service: 'courier' } })}/>
    </View>
    <View style={look.actions}><Button title="Activity" secondary onPress={() => router.push('/activity')}/><Button title="Incoming parcels" secondary onPress={() => router.push('/parcels')}/></View>
    <Text style={styles.small}>{position ? 'The map is centred on this phone. Booking still reads a fresh pickup location when you request a ride.' : 'Tap the location button to centre the map on this phone. Taxi Ai requests a fresh pickup when you book.'}</Text>
  </MapScaffold>;
}
const look=StyleSheet.create({
  brandBar:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},brandChip:{backgroundColor:'rgba(255,255,255,.94)',paddingHorizontal:14,paddingVertical:9,borderRadius:18,
    shadowColor:'#000',shadowOpacity:.08,shadowRadius:10,shadowOffset:{width:0,height:4},elevation:4},
  profileButton:{width:46,height:46,borderRadius:23,backgroundColor:colors.ink,alignItems:'center',justifyContent:'center',borderWidth:3,borderColor:colors.white},
  profileText:{color:colors.white,fontSize:17,fontWeight:'800'},locate:{width:48,height:48,borderRadius:24,backgroundColor:colors.white,alignItems:'center',justifyContent:'center',
    shadowColor:'#000',shadowOpacity:.14,shadowRadius:10,shadowOffset:{width:0,height:4},elevation:5},locateText:{fontSize:25,color:colors.ink,fontWeight:'700'},
  heading:{gap:6},greeting:{fontSize:26,fontWeight:'800',letterSpacing:-.7,color:colors.ink},destination:{minHeight:62,borderRadius:19,backgroundColor:colors.white,
    borderWidth:1,borderColor:colors.border,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:18,shadowColor:'#000',shadowOpacity:.06,shadowRadius:10,shadowOffset:{width:0,height:3},elevation:2},
  destinationDot:{width:10,height:10,borderRadius:5,backgroundColor:colors.yellow},destinationText:{flex:1,fontSize:18,fontWeight:'700',color:colors.ink},arrow:{fontSize:30,color:colors.muted},
  quickRow:{flexDirection:'row',gap:10},quick:{flex:1,minWidth:0,borderRadius:17,paddingVertical:14,paddingHorizontal:10,backgroundColor:colors.white,borderWidth:1,borderColor:colors.border,alignItems:'center'},
  quickTitle:{fontSize:14,fontWeight:'800',color:colors.ink},quickText:{fontSize:10,color:colors.muted,marginTop:3,textAlign:'center'},actions:{flexDirection:'row',gap:10},
});
