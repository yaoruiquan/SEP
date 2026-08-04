'use client';

import { useState } from 'react';
import { X, CreditCard, Wallet, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ─── types ────────────────────────────────────────────────────────────────────

interface PaymentModalProps {
  open: boolean;
  emp: { name: string; price?: number | null };
  subscribing: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

type PaymentMethod = 'card' | 'balance';

// ─── component ───────────────────────────────────────────────────────────────

export function PaymentModal({
  open,
  emp,
  subscribing,
  onConfirm,
  onClose,
}: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>('card');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');

  const isFree = !emp.price || emp.price === 0;
  const canConfirm = isFree || (cardNumber.length >= 16 && expiry && cvv);

  if (!open) return null;

  function handleConfirm() {
    if (!canConfirm || subscribing) return;
    onConfirm();
  }

  return (
    <>
      {/* backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className={cn(
            'glass-card relative w-full max-w-md space-y-5 p-6',
            'animate-in fade-in-0 zoom-in-95 duration-200',
          )}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-labelledby="payment-modal-title"
        >
          {/* header */}
          <div className="flex items-start justify-between">
            <div>
              <h2
                id="payment-modal-title"
                className="text-lg font-semibold text-gtext-primary"
              >
                确认订阅
              </h2>
              <p className="mt-1 text-sm text-gtext-secondary">
                订阅后可为部门创建实例
              </p>
            </div>
            <button
              onClick={onClose}
              disabled={subscribing}
              className="rounded-glass-md p-1.5 text-gtext-muted transition-colors hover:bg-glass-2 hover:text-gtext-primary disabled:pointer-events-none"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* employee + price */}
          <div className="rounded-glass-lg border border-glassline bg-glass-2 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gtext-primary">
                  {emp.name}
                </p>
                <p className="mt-0.5 text-xs text-gtext-muted">硅基员工</p>
              </div>
              <div className="text-right">
                {isFree ? (
                  <span className="text-base font-semibold text-emerald-400">
                    免费
                  </span>
                ) : (
                  <>
                    <p className="text-lg font-semibold text-gtext-primary">
                      ¥{emp.price}
                    </p>
                    <p className="text-xs text-gtext-muted">每月</p>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* payment method (only show for paid employees) */}
          {!isFree && (
            <>
              <div>
                <p className="mb-3 text-sm font-medium text-gtext-primary">
                  支付方式
                </p>
                <div className="flex gap-3">
                  <label
                    className={cn(
                      'flex flex-1 cursor-pointer items-center gap-2.5 rounded-glass-lg border p-3 transition-all',
                      method === 'card'
                        ? 'border-glassline-brand bg-gbrand/10'
                        : 'border-glassline bg-glass-2 hover:bg-glass-3',
                    )}
                  >
                    <input
                      type="radio"
                      name="payment-method"
                      value="card"
                      checked={method === 'card'}
                      onChange={() => setMethod('card')}
                      className="h-4 w-4 accent-gbrand-text"
                    />
                    <CreditCard className="h-4 w-4 text-gtext-secondary" />
                    <span className="text-sm text-gtext-primary">信用卡</span>
                  </label>

                  <label
                    className={cn(
                      'flex flex-1 cursor-pointer items-center gap-2.5 rounded-glass-lg border p-3 transition-all',
                      method === 'balance'
                        ? 'border-glassline-brand bg-gbrand/10'
                        : 'border-glassline bg-glass-2 hover:bg-glass-3',
                    )}
                  >
                    <input
                      type="radio"
                      name="payment-method"
                      value="balance"
                      checked={method === 'balance'}
                      onChange={() => setMethod('balance')}
                      className="h-4 w-4 accent-gbrand-text"
                    />
                    <Wallet className="h-4 w-4 text-gtext-secondary" />
                    <span className="text-sm text-gtext-primary">余额</span>
                  </label>
                </div>
              </div>

              {/* card details (only show when card is selected) */}
              {method === 'card' && (
                <div className="space-y-3">
                  <div>
                    <label
                      htmlFor="card-number"
                      className="mb-1.5 block text-xs font-medium text-gtext-secondary"
                    >
                      卡号
                    </label>
                    <input
                      id="card-number"
                      type="text"
                      placeholder="4242 4242 4242 4242"
                      value={cardNumber}
                      onChange={(e) =>
                        setCardNumber(e.target.value.replace(/\D/g, '').slice(0, 16))
                      }
                      disabled={subscribing}
                      className={cn(
                        'w-full rounded-glass-lg border border-glassline bg-glass-2 px-3 py-2',
                        'text-sm text-gtext-primary placeholder:text-gtext-muted',
                        'transition-colors focus:border-glassline-brand focus:outline-none focus:ring-2 focus:ring-gbrand/40',
                        'disabled:pointer-events-none disabled:opacity-50',
                      )}
                    />
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label
                        htmlFor="expiry"
                        className="mb-1.5 block text-xs font-medium text-gtext-secondary"
                      >
                        有效期
                      </label>
                      <input
                        id="expiry"
                        type="text"
                        placeholder="MM/YY"
                        value={expiry}
                        onChange={(e) => {
                          const val = e.target.value.replace(/\D/g, '');
                          if (val.length <= 2) {
                            setExpiry(val);
                          } else {
                            setExpiry(`${val.slice(0, 2)}/${val.slice(2, 4)}`);
                          }
                        }}
                        disabled={subscribing}
                        className={cn(
                          'w-full rounded-glass-lg border border-glassline bg-glass-2 px-3 py-2',
                          'text-sm text-gtext-primary placeholder:text-gtext-muted',
                          'transition-colors focus:border-glassline-brand focus:outline-none focus:ring-2 focus:ring-gbrand/40',
                          'disabled:pointer-events-none disabled:opacity-50',
                        )}
                      />
                    </div>

                    <div className="flex-1">
                      <label
                        htmlFor="cvv"
                        className="mb-1.5 block text-xs font-medium text-gtext-secondary"
                      >
                        CVV
                      </label>
                      <input
                        id="cvv"
                        type="text"
                        placeholder="123"
                        value={cvv}
                        onChange={(e) =>
                          setCvv(e.target.value.replace(/\D/g, '').slice(0, 3))
                        }
                        disabled={subscribing}
                        className={cn(
                          'w-full rounded-glass-lg border border-glassline bg-glass-2 px-3 py-2',
                          'text-sm text-gtext-primary placeholder:text-gtext-muted',
                          'transition-colors focus:border-glassline-brand focus:outline-none focus:ring-2 focus:ring-gbrand/40',
                          'disabled:pointer-events-none disabled:opacity-50',
                        )}
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* footer */}
          <div className="flex items-center justify-end gap-3 border-t border-glassline pt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={subscribing}
            >
              取消
            </Button>
            <Button
              variant="glass-primary"
              size="sm"
              onClick={handleConfirm}
              disabled={!canConfirm || subscribing}
              className="min-w-[120px]"
            >
              {subscribing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  处理中...
                </>
              ) : isFree ? (
                '免费订阅'
              ) : (
                '确认支付'
              )}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
