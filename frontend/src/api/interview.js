const API_BASE = "/api";

// ── Auth-aware fetch wrapper ──

function authHeaders(extra = {}) {
  const token = localStorage.getItem("token");
  const headers = { ...extra };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

async function authFetch(url, options = {}) {
  const headers = authHeaders(options.headers);
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    window.location.href = "/login";
    throw new Error("Session expired");
  }
  return res;
}

// ── Speech-to-text ──

export async function transcribeAudio(audioBlob) {
  const form = new FormData();
  form.append("file", audioBlob, "recording.webm");
  const res = await authFetch(`${API_BASE}/transcribe`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getTopics() {
  const res = await authFetch(`${API_BASE}/topics`);
  return res.json();
}

export async function createTopic(name, icon = "📝") {
  const res = await authFetch(`${API_BASE}/topics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, icon }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteTopic(key) {
  const res = await authFetch(`${API_BASE}/topics/${encodeURIComponent(key)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Resume ──

export async function getResumeStatus() {
  const res = await authFetch(`${API_BASE}/resume/status`);
  return res.json();
}

export async function uploadResume(file) {
  const form = new FormData();
  form.append("file", file);
  const res = await authFetch(`${API_BASE}/resume/upload`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function startInterview(mode, topic = null) {
  const res = await authFetch(`${API_BASE}/interview/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, topic }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function sendMessage(sessionId, message) {
  const res = await authFetch(`${API_BASE}/interview/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function endInterview(sessionId, answers = null) {
  const options = { method: "POST" };
  if (answers) {
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify({ answers });
  }
  const res = await authFetch(`${API_BASE}/interview/end/${sessionId}`, options);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getReview(sessionId) {
  const res = await authFetch(`${API_BASE}/interview/review/${sessionId}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getReferenceAnswer(topic, question, sessionId = null, questionId = null) {
  const body = { topic, question };
  if (sessionId) body.session_id = sessionId;
  if (questionId != null) body.question_id = questionId;
  const res = await authFetch(`${API_BASE}/interview/reference-answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getHistory(limit = 20, offset = 0, mode = null, topic = null) {
  const params = new URLSearchParams({ limit, offset });
  if (mode) params.set("mode", mode);
  if (topic) params.set("topic", topic);
  const res = await authFetch(`${API_BASE}/interview/history?${params}`);
  return res.json();
}

export async function deleteSession(sessionId) {
  const res = await authFetch(`${API_BASE}/interview/session/${sessionId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getInterviewTopics() {
  const res = await authFetch(`${API_BASE}/interview/topics`);
  return res.json();
}

// ── Graph ──

export async function getGraphData(topic) {
  const res = await authFetch(`${API_BASE}/graph/${topic}`);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Profile & Retrospective ──

export async function getProfile() {
  const res = await authFetch(`${API_BASE}/profile`);
  return res.json();
}

export async function getTopicRetrospective(topic) {
  const res = await authFetch(`${API_BASE}/profile/topic/${topic}/retrospective`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getTopicHistory(topic) {
  const res = await authFetch(`${API_BASE}/profile/topic/${topic}/history`);
  return res.json();
}

// ── Knowledge management ──

export async function getCoreKnowledge(topic) {
  const res = await authFetch(`${API_BASE}/knowledge/${encodeURIComponent(topic)}/core`);
  return res.json();
}

export async function updateCoreKnowledge(topic, filename, content) {
  const res = await authFetch(`${API_BASE}/knowledge/${encodeURIComponent(topic)}/core/${encodeURIComponent(filename)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteCoreKnowledge(topic, filename) {
  const res = await authFetch(`${API_BASE}/knowledge/${encodeURIComponent(topic)}/core/${encodeURIComponent(filename)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createCoreKnowledge(topic, filename, content) {
  const res = await authFetch(`${API_BASE}/knowledge/${encodeURIComponent(topic)}/core`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, content }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function generateKnowledge(topic) {
  const res = await authFetch(`${API_BASE}/knowledge/${encodeURIComponent(topic)}/generate`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Recording review ──

export async function transcribeRecording(audioBlob, mode = "dual") {
  const form = new FormData();
  form.append("file", audioBlob, audioBlob.name || "recording.webm");
  form.append("mode", mode);
  const res = await authFetch(`${API_BASE}/recording/transcribe`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function analyzeRecording(transcript, recordingMode, company, position) {
  const body = { transcript, recording_mode: recordingMode };
  if (company) body.company = company;
  if (position) body.position = position;
  const res = await authFetch(`${API_BASE}/recording/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function getHighFreq(topic) {
  const res = await authFetch(`${API_BASE}/knowledge/${encodeURIComponent(topic)}/high_freq`);
  return res.json();
}

export async function updateHighFreq(topic, content) {
  const res = await authFetch(`${API_BASE}/knowledge/${encodeURIComponent(topic)}/high_freq`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
