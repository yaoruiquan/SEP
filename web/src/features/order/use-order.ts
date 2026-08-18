import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  id: string;
  orderNo: string;
  totalAmount: number;
  items: OrderItem[];
}

export interface AlipayPaymentResponse {
  paymentForm: string;
  orderId: string;
  orderNo: string;
}

export interface RechargeAlipayPaymentResponse {
  paymentForm: string;
  orderId: string;
  orderNo: string;
}

// ── API ────────────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function createOrder(body?: { itemIds?: string[] }): Promise<CreateOrderResponse> {
  const token = authAccessor.getToken();
  const res = await fetch(`${API_BASE}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
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

async function createRechargeAlipayPayment(orderNo: string): Promise<RechargeAlipayPaymentResponse> {
  const token = authAccessor.getToken();
  const res = await fetch(`${API_BASE}/payment/alipay/recharge/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ orderNo }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.message || 'Failed to create recharge payment');
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

export function useCreateRechargeAlipayPayment() {
  return useMutation({
    mutationFn: createRechargeAlipayPayment,
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

/**
 * 支付结果页专用：订单未支付时自动轮询。
 *
 * 与 useOrder 的区别是 staleTime 归零且带 refetchInterval——
 * 否则 10 秒缓存会让轮询拿到的一直是同一份旧数据。
 */
export function usePollingOrder(orderId: string | null) {
  return useQuery({
    queryKey: ['order', orderId],
    queryFn: () => fetchOrder(orderId!),
    enabled: !!orderId,
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'PENDING' ? 2000 : false;
    },
  });
}

/**
 * 主动向支付宝核对订阅订单状态（兜底）。
 *
 * 异步通知可能丢失，导致用户已付款但订阅始终不生效。
 * 结果页在 PENDING 时定期调用它，把这种情况救回来。
 */
export function useReconcileOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (orderId: string) => {
      const token = authAccessor.getToken();
      const res = await fetch(`${API_BASE}/payment/alipay/reconcile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Failed to reconcile order');
      }
      return res.json() as Promise<{ status: string; reconciled: boolean }>;
    },
    onSuccess: (result, orderId) => {
      if (result.reconciled) {
        queryClient.invalidateQueries({ queryKey: ['order', orderId] });
        queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      }
    },
  });
}

export function useOrders() {
  return useQuery({
    queryKey: ['orders'],
    queryFn: fetchOrders,
    staleTime: 30_000,
  });
}
