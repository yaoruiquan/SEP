"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Image, MessageSquareText, Video } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import SettingsCenter from "./SettingsCenter";
import ModelManagement from "./ModelManagement";
import { ImageModelsPanel } from "@/features/admin/image-models-panel";
import { VideoModelsPanel } from "@/features/admin/video-models-panel";
import { ChatModelConnection } from "@/features/admin/chat-model-connection";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type TabType = "settings" | "models";

export default function SettingsPage() {
  return <Suspense fallback={<p className="p-6 text-sm text-fg-muted">正在读取系统设置</p>}><SettingsContent /></Suspense>;
}

function SettingsContent() {
  const search = useSearchParams();
  const router = useRouter();
  const activeTab: TabType = search.get('tab') === 'models' ? 'models' : 'settings';
  const modelTab = search.get('modelTab') === 'video' ? 'video' : search.get('modelTab') === 'image' ? 'image' : 'chat';
  const navigate = (tab: TabType, model = modelTab) => {
    const next = new URLSearchParams(search.toString());
    next.set('tab', tab);
    next.set('modelTab', model);
    router.replace(`/admin/settings?${next.toString()}`, { scroll: false });
  };

  const tabs = [
    { key: "settings" as const, label: "配置中心", icon: "⚙️" },
    { key: "models" as const, label: "模型管理", icon: "🤖" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">系统设置</h1>
        <p className="mt-1 text-sm text-fg-muted">
          按业务域管理平台配置、认证安全与模型
        </p>
      </div>

      {/* Tab Navigation */}
      <Card variant="solid">
        <CardContent className="p-0">
          <div className="flex border-b border-border">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => navigate(tab.key)}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors relative ${
                  activeTab === tab.key
                    ? "text-primary"
                    : "text-fg-muted hover:text-fg-base"
                }`}
              >
                <span>{tab.icon}</span>
                <span>{tab.label}</span>
                {activeTab === tab.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                )}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tab Content */}
      <div className="min-h-[500px] min-w-0">
        {activeTab === "settings" && <SettingsCenter />}
        {activeTab === "models" && <Tabs value={modelTab} onValueChange={(value) => navigate('models', value as typeof modelTab)} className="min-w-0 space-y-4">
          <TabsList aria-label="模型类型" className="grid h-auto w-full grid-cols-3 sm:w-fit">
            <TabsTrigger value="chat"><MessageSquareText className="mr-2 h-4 w-4"/>会话</TabsTrigger>
            <TabsTrigger value="image"><Image className="mr-2 h-4 w-4"/>图片</TabsTrigger>
            <TabsTrigger value="video"><Video className="mr-2 h-4 w-4"/>视频</TabsTrigger>
          </TabsList>
          <TabsContent value="chat" className="min-w-0 space-y-4"><ChatModelConnection /><ModelManagement /></TabsContent>
          <TabsContent value="image" className="min-w-0"><ImageModelsPanel /></TabsContent>
          <TabsContent value="video" className="min-w-0"><VideoModelsPanel /></TabsContent>
        </Tabs>}
      </div>
    </div>
  );
}
