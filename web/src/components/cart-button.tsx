'use client';

import { ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';
import { useCart } from '@/features/cart/use-cart';

export function CartButton() {
  const router = useRouter();
  const { data: cart } = useCart();

  const itemCount = cart?.itemCount || 0;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="relative"
      onClick={() => router.push('/cart')}
    >
      <ShoppingCart className="h-5 w-5" />
      {itemCount > 0 && (
        <Badge
          className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-gbrand-text px-1 text-[10px] font-semibold text-white"
        >
          {itemCount > 99 ? '99+' : itemCount}
        </Badge>
      )}
    </Button>
  );
}
