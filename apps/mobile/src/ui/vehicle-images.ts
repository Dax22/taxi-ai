import type { ImageSourcePropType } from 'react-native';
import white from '../assets/vehicles/sedan-white.png';
import silver from '../assets/vehicles/sedan-silver.png';
import grey from '../assets/vehicles/sedan-grey.png';
import black from '../assets/vehicles/sedan-black.png';
import blue from '../assets/vehicles/sedan-blue.png';
import red from '../assets/vehicles/sedan-red.png';
import green from '../assets/vehicles/sedan-green.png';
import yellow from '../assets/vehicles/sedan-yellow.png';
import gold from '../assets/vehicles/sedan-gold.png';
import brown from '../assets/vehicles/sedan-brown.png';

const images: Readonly<Record<string, ImageSourcePropType>> = Object.freeze({ white, silver, grey, black, blue, red, green, yellow, gold, brown, neutral: white });
export function vehicleImage(colourId: string): ImageSourcePropType { return Object.hasOwn(images, colourId) ? images[colourId] : white; }
