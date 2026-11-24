import { Check, Loader2, Settings as SettingsIcon } from "lucide-react";
import ErrorState from "@/components/ErrorState";
import PageContainer from "@/components/PageContainer";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import AccountSection from "./settings/AccountSection";
import AppearanceSection from "./settings/AppearanceSection";
import DataMigrationSection from "./settings/DataMigrationSection";
import EmbeddingSection from "./settings/EmbeddingSection";
import LlmSection from "./settings/LlmSection";
import ServicesSection from "./settings/ServicesSection";
import SponsorCard from "./settings/SponsorCard";
import TrainingSection from "./settings/TrainingSection";
import { SETTINGS_TABS } from "./settings/constants";
import useSettingsPage from "./settings/useSettingsPage";

export default function Settings() {
  const {
    load,
    save,
    indexRevision,
    retryLoad,
    updateDraft,
    saveSettings,
    activeTab,
    sectionsRef,
    scrollToSection,
  } = useSettingsPage();

  if (load.status === "loading") {
    return (
      <div role="status" aria-label="加载设置中" className="flex flex-1 items-center justify-center text-dim">
        <Loader2 size={20} className="motion-safe:animate-spin" />
      </div>
    );
  }

  return (
    <PageContainer size="default" className="pb-0">
      <PageHeader
        icon={<SettingsIcon size={21} />}
        title="设置"
        description="管理外观、LLM 服务、Embedding 和训练参数。"
        className="mb-6"
      />

      {load.status === "error" ? (
        <ErrorState title="加载设置失败" message={load.message} onRetry={retryLoad} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
            <nav aria-label="设置分区" className="min-w-0 lg:sticky lg:top-4 lg:self-start">
              <div className="scrollbar-subtle flex gap-1 overflow-x-auto lg:flex-col lg:gap-0.5 lg:overflow-visible">
                {SETTINGS_TABS.map(({ id, label, icon: Icon }) => {
                  const active = activeTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-controls={`settings-${id}`}
                      aria-current={active ? "location" : undefined}
                      onClick={() => scrollToSection(id)}
                      className={cn(
                        "group relative flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] transition-all duration-300 lg:w-full",
                        active ? "bg-primary/10 font-medium text-primary" : "text-dim hover:bg-hover hover:text-text",
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 hidden h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary drop-shadow-[0_0_4px_currentColor] lg:block" />
                      )}
                      <Icon
                        size={16}
                        className={cn("shrink-0", active ? "text-primary" : "text-dim group-hover:text-primary")}
                      />
                      <span className="whitespace-nowrap">{label}</span>
                    </button>
                  );
                })}
              </div>
            </nav>

            <div ref={sectionsRef} className="min-w-0 space-y-5">
              <AppearanceSection />
              <LlmSection
                value={load.draft.llm}
                platformLlm={load.platformLlm}
                onChange={(patch) => updateDraft("llm", patch)}
              />
              <EmbeddingSection
                value={load.draft.embedding}
                indexRevision={indexRevision}
                initialLastReindexAt={load.lastReindexAt}
                onChange={(patch) => updateDraft("embedding", patch)}
              />
              <ServicesSection value={load.draft.services} onChange={(patch) => updateDraft("services", patch)} />
              <TrainingSection value={load.draft.training} onChange={(patch) => updateDraft("training", patch)} />
              <AccountSection
                isAdmin={load.isAdmin}
                allowRegistration={load.draft.system.allow_registration}
                onRegistrationChange={(checked) => updateDraft("system", { allow_registration: checked })}
              />
              <DataMigrationSection isAdmin={load.isAdmin} />
              <SponsorCard />
            </div>
          </div>

          <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-border/40 bg-background/85 px-4 py-3 backdrop-blur-md md:-mx-7 md:px-7 xl:-mx-8 xl:px-8">
            <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end">
              {save.status === "error" ? (
                <span className="min-w-0 flex-1 basis-48 break-words text-sm text-red sm:flex-none">{save.message}</span>
              ) : (
                <span className="min-w-0 flex-1 basis-48 text-[12px] text-dim/70 sm:flex-none">
                  保存 LLM + Embedding + 服务密钥 + 训练参数{load.isAdmin ? " + 账户" : ""}。数据迁移独立保存。
                </span>
              )}
              <Button
                type="button"
                variant="gradient"
                className="shrink-0 px-8"
                onClick={saveSettings}
                disabled={save.status === "saving"}
              >
                {save.status === "saving" && <Loader2 size={15} className="motion-safe:animate-spin" />}
                {save.status === "saved" && <Check size={15} />}
                {save.status === "saving" ? "保存中..." : save.status === "saved" ? "已保存" : "保存"}
              </Button>
            </div>
          </div>
        </>
      )}
    </PageContainer>
  );
}
