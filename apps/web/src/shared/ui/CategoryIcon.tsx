import {
  Car,
  Coffee,
  CircleDollarSign,
  Gift,
  Home,
  ShoppingCart,
  Smartphone,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

/**
 * Иконки категорий — только вектор (Lucide), никаких эмодзи: они зависят от
 * платформенного шрифта и не подчиняются токенам цвета/размера.
 */
const ICONS: Record<string, LucideIcon> = {
  wallet: Wallet,
  'shopping-cart': ShoppingCart,
  coffee: Coffee,
  car: Car,
  home: Home,
  gift: Gift,
  smartphone: Smartphone,
};

interface CategoryIconProps {
  name: string | null;
  color?: string | null;
  size?: number;
  className?: string;
}

export function CategoryIcon({ name, color, size = 20, className }: CategoryIconProps) {
  const Icon = (name && ICONS[name]) || CircleDollarSign;
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
