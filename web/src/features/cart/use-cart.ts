import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authAccessor } from '@/lib/auth-store';

// ── Types ──────────────────────────────────────────────────────────────────

export interface CartItem {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeAvatar: string | null;
  unitPrice: number;
  periodMonths: number;
  quantity: number;
  subtotal: number;
  includedComputeCNY: number;
  addedAt: string;
}

export interface CartSummary {
  items: CartItem[];
  totalAmount: number;
  totalIncludedCompute: number;
  itemCount: number;
}

export interface AddToCartDto {
  employeeId: string;
  periodMonths?: number;
  quantity?: number;
}

export interface UpdateCartItemDto {
  periodMonths?: number;
  quantity?: number;
}

// ── API ────────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function fetchCart(): Promise<CartSummary> {
  const token = authAccessor.getToken();
  const res = await fetch(`${API_BASE}/cart`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Failed to fetch cart');
  return res.json();
}

async function addToCart(dto: AddToCartDto): Promise<{ message: string }> {
  const token = authAccessor.getToken();
  const res = await fetch(`${API_BASE}/cart/items`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(dto),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to add to cart');
  }
  return res.json();
}

async function updateCartItem(
  itemId: string,
  dto: UpdateCartItemDto,
): Promise<{ message: string }> {
  const token = authAccessor.getToken();
  const res = await fetch(`${API_BASE}/cart/items/${itemId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(dto),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to update cart item');
  }
  return res.json();
}

async function removeCartItem(itemId: string): Promise<{ message: string }> {
  const token = authAccessor.getToken();
  const res = await fetch(`${API_BASE}/cart/items/${itemId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to remove cart item');
  }
  return res.json();
}

async function clearCart(): Promise<{ message: string; deletedCount: number }> {
  const token = authAccessor.getToken();
  const res = await fetch(`${API_BASE}/cart`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to clear cart');
  }
  return res.json();
}

// ── Hooks ──────────────────────────────────────────────────────────────────

export function useCart() {
  return useQuery({
    queryKey: ['cart'],
    queryFn: fetchCart,
    staleTime: 30_000,
  });
}

export function useAddToCart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: addToCart,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
  });
}

export function useUpdateCartItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, dto }: { itemId: string; dto: UpdateCartItemDto }) =>
      updateCartItem(itemId, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
  });
}

export function useRemoveCartItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeCartItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
  });
}

export function useClearCart() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: clearCart,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cart'] });
    },
  });
}
