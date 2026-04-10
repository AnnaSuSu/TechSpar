import { authFetch } from "./interview";

const API_BASE = "/api";

export async function getVoiceprintStatus() {
  const res = await authFetch(`${API_BASE}/voiceprint/status`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function putVoiceprintCredentials({ secret_id, secret_key, app_id = "" }) {
  const res = await authFetch(`${API_BASE}/voiceprint/credentials`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret_id, secret_key, app_id }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function enrollVoiceprint(wavBlob) {
  const form = new FormData();
  form.append("file", wavBlob, "voiceprint.wav");
  const res = await authFetch(`${API_BASE}/voiceprint/enroll`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteVoiceprintEnrollment() {
  const res = await authFetch(`${API_BASE}/voiceprint/enroll`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
