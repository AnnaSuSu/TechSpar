import type { SettingsResponse } from "@/api/settings";
import type { SETTINGS_TABS } from "./constants";

export type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

export type SettingsDraft = Pick<SettingsResponse, "llm" | "embedding" | "system" | "training"> & {
  services: Required<SettingsResponse["services"]>;
};

export interface SettingsSectionProps<K extends keyof SettingsDraft> {
  value: SettingsDraft[K];
  onChange: (patch: Partial<SettingsDraft[K]>) => void;
}

export type ConnectionTestResult =
  | { status: "testing" | "ok" }
  | { status: "fail"; error?: string };
