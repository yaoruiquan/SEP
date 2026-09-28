"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import SettingsCenter from "./SettingsCenter";
import ModelManagement from "./ModelManagement";

type TabType = "settings" | "models";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabType>("settings");

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
                onClick={() => setActiveTab(tab.key)}
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
      <div className="min-h-[500px]">
        {activeTab === "settings" && <SettingsCenter />}
        {activeTab === "models" && <ModelManagement />}
      </div>
    </div>
  );
}
