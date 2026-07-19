import {
  Baby,
  Banknote,
  Briefcase,
  Car,
  Coffee,
  CircleDollarSign,
  Dumbbell,
  Fuel,
  GraduationCap,
  Gift,
  HeartPulse,
  Home,
  PawPrint,
  PiggyBank,
  Pizza,
  Plane,
  Shirt,
  ShoppingCart,
  Smartphone,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { CategoryIconName } from '@budget/shared';

/**
 * Иконки категорий — только вектор (Lucide), никаких эмодзи: они зависят от
 * платформенного шрифта и не подчиняются токенам цвета/размера.
 *
 * Ключи перечислены в `CATEGORY_ICONS` (@budget/shared) — по тому же списку бэк
 * валидирует созданные категории, поэтому таблица обязана покрывать его целиком.
 */
const ICONS: Record<CategoryIconName, LucideIcon> = {
  wallet: Wallet,
  'shopping-cart': ShoppingCart,
  coffee: Coffee,
  car: Car,
  home: Home,
  gift: Gift,
  smartphone: Smartphone,
  'heart-pulse': HeartPulse,
  plane: Plane,
  shirt: Shirt,
  'graduation-cap': GraduationCap,
  dumbbell: Dumbbell,
  pizza: Pizza,
  fuel: Fuel,
  baby: Baby,
  'paw-print': PawPrint,
  briefcase: Briefcase,
  'piggy-bank': PiggyBank,
  'trending-up': TrendingUp,
  banknote: Banknote,
};

interface CategoryIconProps {
  name: string | null;
  color?: string | null;
  size?: number;
  className?: string;
}

export function CategoryIcon({ name, color, size = 20, className }: CategoryIconProps) {
  const Icon = (name && ICONS[name as CategoryIconName]) || CircleDollarSign;
  // Единая толщина штриха по всему интерфейсу — иначе теряется ощущение цельности.
  return (
    <Icon
      size={size}
      strokeWidth={1.75}
      className={className}
      style={color ? { color } : undefined}
      aria-hidden="true"
    />
  );
}
