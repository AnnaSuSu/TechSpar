/**
 * Verify ownership without loading business data. Transient failures leave the
 * saved session intact so the caller can offer a retry.
 * @param {string} token
 * @param {string} expectedUserId
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} [options]
 * @returns {Promise<{ status: "verified", id: string, needsOnboarding: boolean } | { status: "expired" }>}
 */
export async function verifySession(token, expectedUserId, { fetchImpl = globalThis.fetch, signal } = {}) {
  const options = { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal };
  const identityResponse = await fetchImpl("/api/auth/me", options);
  if (identityResponse.status === 401) return { status: "expired" };
  if (!identityResponse.ok) throw new Error("登录状态验证暂时失败");
  const identity = await identityResponse.json();
  if (typeof identity?.id !== "string" || !identity.id) throw new Error("登录状态验证暂时失败");
  if (identity.id !== expectedUserId) return { status: "expired" };

  const settingsResponse = await fetchImpl("/api/settings", options);
  if (settingsResponse.status === 401) return { status: "expired" };
  if (!settingsResponse.ok) throw new Error("设置暂时无法加载");
  const settings = await settingsResponse.json();
  if (typeof settings?.configured?.llm !== "boolean" || typeof settings?.configured?.embedding !== "boolean") {
    throw new Error("设置暂时无法加载");
  }
  return { status: "verified", id: identity.id, needsOnboarding: !(settings.configured.llm && settings.configured.embedding) };
}
