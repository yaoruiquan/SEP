import Image from 'next/image';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <div className="hidden w-1/2 flex-col justify-between bg-primary p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="硅基人才平台" width={32} height={32} className="rounded" priority />
          <span className="text-xl font-semibold tracking-tight">硅基人才平台</span>
        </div>
        <div className="space-y-4">
          <h1 className="text-4xl font-bold leading-tight">
            订阅碳基员工
            <br />
            调度硅基能力
          </h1>
          <p className="max-w-md text-white/80">
            像招募团队一样订阅数字员工，用一句话驱动 Agent、RPA、技能与 AI
            应用，把重复工作交给硅基劳动力。
          </p>
        </div>
        <div className="text-sm text-white/60">© 2026 Silicon Talent Platform</div>
      </div>
      {/* Form panel */}
      <div className="flex w-full items-center justify-center bg-background px-6 lg:w-1/2">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
