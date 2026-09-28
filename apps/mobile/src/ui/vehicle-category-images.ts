import type { ImageSourcePropType } from 'react-native';
import type { VehicleCategoryId } from '../../../../packages/shared/src/vehicle-categories.mjs';
import standard from '../assets/vehicles/sedan-white.png';
import suv from '../assets/vehicles/category-suv.png';
import van from '../assets/vehicles/category-van.png';
import truck from '../assets/vehicles/category-truck.png';
import motorcycle from '../assets/vehicles/category-motorcycle.png';

export const categoryImages: Readonly<Record<VehicleCategoryId, ImageSourcePropType>> = Object.freeze({ standard, suv, van, truck, motorcycle });
