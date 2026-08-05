'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, CreditCard, Wallet, Loader2, CheckCircle2, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ─── types ────────────────────────────────────────────────────────────────────

interface PaymentModalProps {
  open: boolean;
  emp: { name: string; price?: number | null };
  subscribing: boolean;
  /** 订阅成功时由父组件设为 true，弹窗切换到引导界面 */
  succeeded?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

type PaymentMethod = 'card' | 'balance';

// ─── success screen ───────────────────────────────────────────────────────────

function SuccessScreen({
  empName,
  onClose,
}: {
  empName: string;
  onClose: () => void;
}) {
  const router = useRouter();

  function goToEmployees() {
    onClose();
    router.push('/my-employees');
  }

  return (
    <div className="flex flex-col items-center gap-5 py-4 text-center">
      {/* icon */}
      <div className="flex h-16 w-16 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10">
        <CheckCircle2 className="h-8 w-8 text-emerald-400" />
      </div>

      {/* title */}
      <div className="space-y-1.5">
        <h2 className="text-xl font-semibold text-gtext-primary">订阅成功！</h2>
        <p className="text-sm text-gtext-secondary">
          <span className="font-medium text-gtext-primary">「{empName}」</span>{' '}
          已加入你的员工列表
        </p>
      </div>

      {/* hint */}
      <p className="max-w-xs rounded-glass-lg border border-glassline bg-glass-2 px-4 py-3 text-xs text-gtext-muted leading-relaxed">
        接下来，企业管理员可以在「员工实例」中为员工创建实例并分配给部门或成员使用。
      </p>

      {/* CTAs */}
      <div className="flex w-full flex-col gap-2.5">
        <Button
          variant="glass-primary"
          size="sm"
          className="w-full"
          onClick={goToEmployees}
        >
          去我的员工
          <ArrowRight className="ml-1.5 h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={onClose}
        >
          继续逛市场
        </Button>
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export function PaymentModal({
  open,
  emp,
  subscribing,
  succeeded = false,
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
        onClick={succeeded ? undefined : onClose}
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
          {/* close button — hidden on success screen (CTAs replace it) */}
          {!succeeded && (
            <button
              onClick={onClose}
              disabled={subscribing}
              className="absolute right-4 top-4 rounded-glass-md p-1.5 text-gtext-muted transition-colors hover:bg-glass-2 hover:text-gtext-primary disabled:pointer-events-none"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          {/* ── success screen ── */}
          {succeeded ? (
            <SuccessScreen empName={emp.name} onClose={onClose} />
          ) : (
            <>
              {/* header */}
              <div className="pr-8">
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

                  {/* card details */}
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
            </>
          )}
        </div>
      </div>
    </>
  );
}
