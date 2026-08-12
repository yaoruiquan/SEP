import { useMutation, useQuery } from '@tanstack/react-query';
import { authAccessor } from '@/lib/auth-store';

// ── Types ──────────────────────────────────────────────────────────────────

export interface Order {
  id: string;
  orderNo: string;
  totalAmount: number;
  status: 'PENDING' | 'PAID' | 'CANCELED' | 'FAILED';
  items: OrderItem[];
  createdAt: string;
  paidAt: string | null;
}

export interface OrderItem {
  id: string;
  employeeName: string;
  employeeAvatar: string | null;
  unitPrice: number;
  periodMonths: number;
  quantity: number;
  subtotal: number;
}

export interface CreateOrderResponse {
  orderId: string;
  orderNo: string;
  totalAmount: number;
  items: OrderItem[];
}

export interface AlipayPaymentResponse {
  paymentUrl: string;
  orderId: string;
  orderNo: string;
}

// ── API ────────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function createOrder(): Promise<CreateOrderResponse> {
  const token = authAccessor.getToken();
  const res = await fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to create order');
  }
  return res.json();
}

async function createAlipayPayment(orderId: string): Promise<AlipayPaymentResponse> {
  const token = authAccessor.getToken();
  const res = await fetch(`${API_BASE}/payment/alipay/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderId }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to create payment');
  }
  return res.json();
}

async function fetchOrder(orderId: string): Promise<Order> {
  const token = authAccessor.getToken();
  const res = await fetch(`${API_BASE}/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to fetch order');
  }
  return res.json();
}

async function fetchOrders(): Promise<Order[]> {
  const token = authAccessor.getToken();
  const res = await fetch(`${API_BASE}/orders`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to fetch orders');
  }
  return res.json();
}

// ── Hooks ──────────────────────────────────────────────────────────────────

export function useCreateOrder() {
  return useMutation({
    mutationFn: createOrder,
  });
}

export function useCreateAlipayPayment() {
  return useMutation({
    mutationFn: createAlipayPayment,
  });
}

export function useOrder(orderId: string | null) {
  return useQuery({
    queryKey: ['order', orderId],
    queryFn: () => fetchOrder(orderId!),
    enabled: !!orderId,
    staleTime: 10_000,
  });
}

export function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    queryFn: fetchOrders,
    staleTime: 30_000,
  });
}
