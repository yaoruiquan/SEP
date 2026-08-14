'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShoppingCart, Trash2, ArrowRight, PackageOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { useCart, useUpdateCartItem, useRemoveCartItem, useClearCart } from '@/features/cart/use-cart';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export default function CartPage() {
  const router = useRouter();
  const { data: cart, isLoading } = useCart();
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();
  const clearCart = useClearCart();

  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [removeItemId, setRemoveItemId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handlePeriodChange = (itemId: string, months: number) => {
    updateItem.mutate(
      { itemId, dto: { periodMonths: months } },
      {
        onError: (err) => toast.error((err as Error).message),
      },
    );
  };

  const handleRemoveItem = (itemId: string) => {
    removeItem.mutate(itemId, {
      onSuccess: () => {
        toast.success('已从购物车移除');
        setRemoveItemId(null);
        // 从选中列表中移除
        setSelectedIds((prev) => {
          const newSet = new Set(prev);
          newSet.delete(itemId);
          return newSet;
        });
      },
      onError: (err) => toast.error((err as Error).message),
    });
  };

  const handleClearCart = () => {
    clearCart.mutate(undefined, {
      onSuccess: () => {
        toast.success('购物车已清空');
        setClearDialogOpen(false);
        setSelectedIds(new Set());
      },
      onError: (err) => toast.error((err as Error).message),
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (!cart) return;
    if (checked) {
      setSelectedIds(new Set(cart.items.map((item) => item.id)));
    } else {
      setSelectedIds(new Set());
    }
  };

  const handleSelectItem = (itemId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(itemId);
      } else {
        newSet.delete(itemId);
      }
      return newSet;
    });
  };

  const handleCheckout = () => {
    if (!cart || cart.items.length === 0) return;

    if (selectedIds.size === 0) {
      toast.error('请至少选择一个商品');
      return;
    }

    // 传递选中的商品 ID 到结算页面
    const itemIds = Array.from(selectedIds).join(',');
    router.push(`/checkout?items=${itemIds}`);
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <Card>
          <CardContent className="py-12">
            <div className="flex items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-gbrand-text border-t-transparent" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  const isEmpty = !cart || cart.items.length === 0;
  const allSelected = cart && cart.items.length > 0 && selectedIds.size === cart.items.length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      {/* 页头 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gtext-primary">购物车</h1>
          <p className="mt-1 text-sm text-gtext-secondary">
            {isEmpty ? '购物车是空的' : `${cart.itemCount} 个商品`}
          </p>
        </div>
        {!isEmpty && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setClearDialogOpen(true)}
            disabled={clearCart.isPending}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            清空购物车
          </Button>
        )}
      </div>

      {isEmpty ? (
        <Card>
          <CardContent className="py-12">
            <EmptyState
              icon={<PackageOpen className="h-12 w-12" />}
              title="购物车是空的"
              description="去硅基员工市场添加员工订阅"
              action={{
                label: '浏览员工市场',
                onClick: () => router.push('/marketplace'),
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* 购物车商品列表 */}
          <div className="space-y-4 lg:col-span-2">
            {/* 全选复选框 */}
            <div className="flex items-center gap-3 rounded-lg border border-glassline bg-glass-1 px-4 py-3">
              <Checkbox
                checked={allSelected}
                onCheckedChange={handleSelectAll}
                id="select-all"
              />
              <label
                htmlFor="select-all"
                className="flex-1 cursor-pointer text-sm font-medium text-gtext-primary"
              >
                全选
              </label>
              <span className="text-xs text-gtext-secondary">
                已选 {selectedIds.size} / {cart.items.length} 件
              </span>
            </div>

            {cart.items.map((item) => (
              <Card key={item.id} className="glass-card overflow-hidden">
                <CardContent className="p-5">
                  <div className="flex gap-4">
                    {/* 复选框 */}
                    <div className="flex items-start pt-1">
                      <Checkbox
                        checked={selectedIds.has(item.id)}
                        onCheckedChange={(checked) => handleSelectItem(item.id, checked as boolean)}
                        id={`item-${item.id}`}
                      />
                    </div>

                    {/* 员工头像 */}
                    <Avatar
                      name={item.employeeName}
                      src={item.employeeAvatar}
                      className="h-16 w-16 shrink-0 ring-2 ring-white/15"
                    />

                    {/* 商品信息 */}
                    <div className="min-w-0 flex-1 space-y-3">
                      <div>
                        <h3 className="font-medium text-gtext-primary">{item.employeeName}</h3>
                        <p className="mt-1 text-sm text-gtext-secondary">
                          ¥{item.unitPrice.toLocaleString()} / 年
                        </p>
                      </div>

                      {/* 周期选择 */}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-gtext-secondary">订阅周期：</span>
                        <div className="flex gap-1">
                          {[3, 6, 12, 24, 36].map((months) => (
                            <button
                              key={months}
                              onClick={() => handlePeriodChange(item.id, months)}
                              disabled={updateItem.isPending}
                              className={`rounded-md px-3 py-1.5 text-xs transition-all ${
                                item.periodMonths === months
                                  ? 'bg-gbrand-text/15 font-medium text-gbrand-text ring-1 ring-gbrand-text/30'
                                  : 'bg-glass-2 text-gtext-secondary hover:bg-glass-3 hover:text-gtext-primary'
                              }`}
                            >
                              {months}个月
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* 小计。收敛后一员工一雇佣关系，没有数量可调 */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gtext-muted">
                          雇佣后可授权给多个部门与成员
                        </span>

                        <div className="text-right">
                          <div className="text-lg font-semibold text-gbrand-text">
                            ¥{item.subtotal.toLocaleString()}
                          </div>
                          <div className="text-xs text-gtext-muted">
                            🎁 赠送 ¥{item.includedComputeCNY.toLocaleString()} 算力
                          </div>
                        </div>
                      </div>

                      {/* 移除按钮 */}
                      <div className="flex justify-end">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRemoveItemId(item.id)}
                          disabled={removeItem.isPending}
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                          移除
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* 订单汇总 */}
          <div className="lg:col-span-1">
            <Card className="glass-card sticky top-6">
              <CardHeader className="border-b border-glassline">
                <h2 className="text-lg font-semibold text-gtext-primary">订单汇总</h2>
              </CardHeader>
              <CardContent className="space-y-4 p-5">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gtext-secondary">已选商品</span>
                    <span className="font-medium text-gtext-primary">{selectedIds.size} 件</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-gtext-secondary">赠送算力</span>
                    <span className="font-medium text-gtext-primary">
                      ¥
                      {cart.items
                        .filter((item) => selectedIds.has(item.id))
                        .reduce((sum, item) => sum + item.includedComputeCNY, 0)
                        .toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="border-t border-glassline pt-4">
                  <div className="flex justify-between">
                    <span className="text-base font-medium text-gtext-primary">总计</span>
                    <span className="text-2xl font-bold text-gbrand-text">
                      ¥
                      {cart.items
                        .filter((item) => selectedIds.has(item.id))
                        .reduce((sum, item) => sum + item.subtotal, 0)
                        .toLocaleString()}
                    </span>
                  </div>
                </div>

                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  onClick={handleCheckout}
                  disabled={selectedIds.size === 0}
                >
                  去结算 ({selectedIds.size})
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>

                <p className="text-center text-xs text-gtext-muted">
                  点击「去结算」即表示同意服务条款
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* 清空购物车确认 */}
      <ConfirmDialog
        open={clearDialogOpen}
        onOpenChange={setClearDialogOpen}
        title="确认清空购物车？"
        description="这将移除所有商品，此操作无法撤销。"
        confirmText="清空"
        cancelText="取消"
        onConfirm={handleClearCart}
        variant="danger"
      />

      {/* 移除单个商品确认 */}
      <ConfirmDialog
        open={!!removeItemId}
        onOpenChange={(open) => !open && setRemoveItemId(null)}
        title="确认移除该商品？"
        description="此操作无法撤销。"
        confirmText="移除"
        cancelText="取消"
        onConfirm={() => {
          if (removeItemId) handleRemoveItem(removeItemId);
        }}
        variant="danger"
      />
    </div>
  );
}
