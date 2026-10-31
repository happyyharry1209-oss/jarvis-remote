import { STORAGE, backendWsUrl, normalizeBackend } from "./config.js";

const refs = {
  offline: document.querySelector("#offline-banner"),
  status: document.querySelector("#status"),
  statusText: document.querySelector("#status-text"),
  secure: document.querySelector("#secure"),
  audioToggle: document.querySelector("#audio-toggle"),
  aside: document.querySelector("aside"),
  pairPanel: document.querySelector("#pair-panel"),
  pairForm: document.querySelector("#pair-form"),
  backend: document.querySelector("#backend"),
  pairKey: document.querySelector("#pair-key"),
  pairButton: document.querySelector("#pair-button"),
  pairError: document.querySelector("#pair-error"),
  connectionPanel: document.querySelector("#connection-panel"),
  backendDisplay: document.querySelector("#backend-display"),
  disconnect: document.querySelector("#disconnect"),
  feed: document.querySelector("#feed"),
  emptyState: document.querySelector("#empty-state"),
  command: document.querySelector("#command"),
  send: document.querySelector("#send"),
  mic: document.querySelector("#mic"),
  wake: document.querySelector("#wake"),
  file: document.querySelector("#file-input"),
  toast: document.querySelector("#toast"),
};

const state = {
  backend: "",
  token: "",
  sessionKey: "",
  aesKey: null,
  ws: null,
  voiceWs: null,
  audioContext: null,
  audioNode: null,
  mediaStream: null,
  reconnectTimer: null,
  healthTimer: null,
  toastTimer: null,
  online: false,
  phoneAudioEnabled: localStorage.getItem("jarvis_phone_audio") !== "off",
  audioContext: null,
  audioNextTime: 0,
  audioSources: new Set(),
};

const AES_SALT = "JARVIS-DASHBOARD-v1";
const KDF_ROUNDS = 200000;

function endpoint(path) {
  return `${state.backend}${path}`;
}

function authHeaders() {
  return { Authorization: `Bearer ${state.token}` };
}

function authFetch(path, options = {}) {
  options.headers = { ...(options.headers || {}), ...authHeaders() };
  return fetch(endpoint(path), options);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function setStatus(text, on = false) {
  refs.statusText.textContent = text;
  refs.status.classList.toggle("on", on);
}

function setOnline(online) {
  state.online = online;
  refs.offline.hidden = online;
  if (!online) {
    setStatus("離線", false);
    if (!refs.emptyState.hidden) refs.emptyState.textContent = "JARVIS 離線";
  }
}

function toast(message) {
  refs.toast.textContent = message;
  refs.toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => refs.toast.classList.remove("show"), 2600);
}

function addMessage(kind, text, label = "") {
  refs.emptyState.hidden = true;
  const node = document.createElement("div");
  node.className = `message ${kind}`;
  if (label) {
    const heading = document.createElement("div");
    heading.className = "eyebrow";
    heading.textContent = label;
    node.appendChild(heading);
  }
  const body = document.createElement("span");
  body.textContent = text;
  node.appendChild(body);
  refs.feed.appendChild(node);
  refs.feed.scrollTop = refs.feed.scrollHeight;
}

function showSystem(text) {
  addMessage("system", text);
}

function showPairing(message = "") {
  refs.pairPanel.hidden = false;
  refs.connectionPanel.hidden = true;
  refs.aside.classList.add("visible");
  refs.pairError.textContent = message;
  refs.emptyState.hidden = false;
  refs.emptyState.textContent = "尚未連接 JARVIS";
}

function showConnection() {
  refs.pairPanel.hidden = true;
  refs.connectionPanel.hidden = false;
  refs.backendDisplay.textContent = state.backend;
  refs.aside.classList.remove("visible");
  refs.emptyState.textContent = "正在連接 JARVIS…";
}

async function initCrypto(key) {
  state.aesKey = null;
  refs.secure.hidden = true;
  if (!key || !window.crypto?.subtle) return;
  try {
    const encoder = new TextEncoder();
    const material = await crypto.subtle.importKey(
      "raw",
      encoder.encode(key),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    state.aesKey = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: encoder.encode(AES_SALT),
        iterations: KDF_ROUNDS,
        hash: "SHA-256",
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"]
    );
    refs.secure.textContent = "AES-GCM";
    refs.secure.hidden = false;
  } catch {
    refs.secure.hidden = true;
  }
}

async function encryptCommand(text) {
  if (!state.aesKey) return null;
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      state.aesKey,
      new TextEncoder().encode(text)
    )
  );
  const payload = new Uint8Array(nonce.length + ciphertext.length);
  payload.set(nonce, 0);
  payload.set(ciphertext, nonce.length);
  let binary = "";
  for (const byte of payload) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function persistSession() {
  sessionStorage.setItem(STORAGE.token, state.token);
  sessionStorage.setItem(STORAGE.key, state.sessionKey);
  localStorage.setItem(STORAGE.backend, state.backend);
}

function clearSession() {
  clearTimeout(state.reconnectTimer);
  clearTimeout(state.healthTimer);
  state.ws?.close();
  stopVoice();
  state.ws = null;
  state.token = "";
  state.sessionKey = "";
  state.aesKey = null;
  stopPhoneAudio();
  refs.secure.hidden = true;
  sessionStorage.removeItem(STORAGE.token);
  sessionStorage.removeItem(STORAGE.key);
  localStorage.removeItem(STORAGE.device);
}

function connectSocket() {
  if (!state.backend || !state.token) return;
  state.ws?.close();
  setStatus("連線中", false);
  const socket = new WebSocket(
    backendWsUrl(state.backend, "/ws", state.token, { audio: "1" })
  );
  state.ws = socket;
  socket.binaryType = "arraybuffer";

  socket.onopen = () => {
    setOnline(true);
    setStatus("已連線", true);
    refs.emptyState.hidden = true;
    showSystem("Remote session active.");
  };
  socket.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      queuePhoneAudio(event.data);
      return;
    }
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "log") {
      addMessage(
        message.speaker === "jarvis" ? "jarvis" : "user",
        message.text || "",
        message.speaker === "jarvis" ? "JARVIS" : "YOU"
      );
    } else if (message.type === "status") {
      const active = message.state === "active";
      setStatus(active ? "使用中" : "休眠", true);
      refs.wake.hidden = active;
    } else if (message.type === "wake") {
      showSystem("Wake word detected — connecting…");
    } else if (message.type === "sys") {
      showSystem(message.text || "");
    } else if (message.type === "file_received") {
      addFileCard(message.name, message.size);
    }
  };
  socket.onclose = (event) => {
    if (state.ws !== socket) return;
    state.ws = null;
    setStatus("重新連線中", false);
    if (event.code === 4001) {
      tryDeviceLogin().then((ok) => {
        if (!ok) scheduleReconnect();
      });
    } else {
      scheduleReconnect();
    }
  };
  socket.onerror = () => {
    showSystem("Connection error.");
  };
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = setTimeout(async () => {
    const online = await checkHealth();
    if (online && state.token) connectSocket();
    else if (online && !(await tryDeviceLogin())) scheduleReconnect();
  }, 3000);
}

async function checkHealth() {
  if (!state.backend) return false;
  try {
    const response = await fetchWithTimeout(endpoint("/login"), {
      method: "GET",
      cache: "no-store",
      mode: "cors",
    });
    const online = response.ok;
    setOnline(online);
    return online;
  } catch {
    setOnline(false);
    return false;
  }
}

function startHealthMonitor() {
  clearTimeout(state.healthTimer);
  const poll = async () => {
    await checkHealth();
    state.healthTimer = setTimeout(poll, 10000);
  };
  poll();
}

async function pair(backendValue, keyValue) {
  refs.pairError.textContent = "";
  refs.pairButton.disabled = true;
  try {
    state.backend = normalizeBackend(backendValue);
    const key = String(keyValue || "").trim().toUpperCase();
    if (key.length !== 8) throw new Error("一次性金鑰必須是 8 個字元。");
    setStatus("配對中", false);
    const response = await fetchWithTimeout(
      endpoint("/login"),
      {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: key }),
      },
      15000
    );
    const data = await response.json();
    if (!response.ok || !data.ok || !data.token) {
      throw new Error(data.error || "配對失敗，請在電腦重新產生金鑰。");
    }
    state.token = data.token;
    state.sessionKey = data.key || key;
    if (data.device_token) {
      localStorage.setItem(STORAGE.device, data.device_token);
    }
    persistSession();
    await initCrypto(state.sessionKey);
    history.replaceState({}, "", location.pathname);
    showConnection();
    setOnline(true);
    connectSocket();
    startHealthMonitor();
    toast("已連接 JARVIS");
    return true;
  } catch (error) {
    await checkHealth();
    const failedFetch =
      error instanceof TypeError || /Failed to fetch/i.test(error.message || "");
    showPairing(
      failedFetch
        ? "無法連接。請確認 Tailscale 已連線，並允許瀏覽器存取本機網絡。"
        : error.message || "無法連接 JARVIS。"
    );
    return false;
  } finally {
    refs.pairButton.disabled = false;
  }
}

async function tryDeviceLogin() {
  const deviceToken = localStorage.getItem(STORAGE.device);
  if (!state.backend || !deviceToken) return false;
  try {
    const response = await fetchWithTimeout(
      endpoint("/api/device-login"),
      {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_token: deviceToken }),
      },
      8000
    );
    const data = await response.json();
    if (!response.ok || !data.ok || !data.token) return false;
    state.token = data.token;
    state.sessionKey = data.key || "";
    persistSession();
    await initCrypto(state.sessionKey);
    showConnection();
    setOnline(true);
    connectSocket();
    startHealthMonitor();
    return true;
  } catch {
    return false;
  }
}

function socketPath(path, token) {
  return backendWsUrl(state.backend, path, token);
}

function updatePhoneAudioButton() {
  refs.audioToggle.classList.toggle("off", !state.phoneAudioEnabled);
  refs.audioToggle.setAttribute(
    "aria-pressed",
    state.phoneAudioEnabled ? "true" : "false"
  );
  refs.audioToggle.firstElementChild.textContent =
    state.phoneAudioEnabled ? "🔊" : "🔇";
}

async function unlockPhoneAudio() {
  if (!state.phoneAudioEnabled) return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!state.audioContext) {
    state.audioContext = new AudioCtx({ sampleRate: 24000 });
  }
  if (state.audioContext.state === "suspended") {
    try {
      await state.audioContext.resume();
    } catch {
      return null;
    }
  }
  return state.audioContext;
}

function stopPhoneAudio() {
  for (const source of state.audioSources) {
    try {
      source.stop();
    } catch {}
  }
  state.audioSources.clear();
  state.audioNextTime = 0;
}

async function queuePhoneAudio(buffer) {
  if (!state.phoneAudioEnabled || !buffer.byteLength) return;
  const context = await unlockPhoneAudio();
  if (!context || context.state !== "running") return;
  const pcm = new Int16Array(buffer);
  if (!pcm.length) return;

  const audioBuffer = context.createBuffer(1, pcm.length, 24000);
  const channel = audioBuffer.getChannelData(0);
  for (let index = 0; index < pcm.length; index += 1) {
    channel[index] = pcm[index] / 32768;
  }

  const source = context.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(context.destination);
  const now = context.currentTime;
  if (state.audioNextTime < now + 0.06 || state.audioNextTime > now + 2) {
    state.audioNextTime = now + 0.06;
  }
  source.start(state.audioNextTime);
  state.audioNextTime += audioBuffer.duration;
  state.audioSources.add(source);
  source.onended = () => state.audioSources.delete(source);
}

async function togglePhoneAudio() {
  state.phoneAudioEnabled = !state.phoneAudioEnabled;
  localStorage.setItem(
    "jarvis_phone_audio",
    state.phoneAudioEnabled ? "on" : "off"
  );
  if (state.phoneAudioEnabled) {
    const context = await unlockPhoneAudio();
    toast(context?.state === "running" ? "手機聲音已開啟" : "再點一下以啟用手機聲音");
  } else {
    stopPhoneAudio();
    toast("手機聲音已關閉");
  }
  updatePhoneAudioButton();
}

async function sendCommand() {
  const text = refs.command.value.trim();
  if (!text) return;
  if (!state.token) {
    showSystem("尚未連接 JARVIS。");
    return;
  }
  refs.command.value = "";
  addMessage("user", text, "YOU");
  try {
    const encrypted = await encryptCommand(text);
    const response = await authFetch("/api/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(encrypted ? { enc: encrypted } : { text }),
    });
    if (!response.ok) throw new Error("Command request failed");
  } catch {
    showSystem("指令未能送到 JARVIS。");
    setOnline(false);
  }
}

async function wakeJarvis() {
  try {
    const response = await authFetch("/api/wake", { method: "POST" });
    if (!response.ok) throw new Error("Wake request failed");
    showSystem("Sending wake signal…");
  } catch {
    showSystem("Wake signal failed.");
    setOnline(false);
  }
}

function fileIcon(name) {
  const extension = (name.split(".").pop() || "").toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "heic"].includes(extension)) return "🖼️";
  if (["mp4", "mov", "mkv", "webm"].includes(extension)) return "🎬";
  if (["mp3", "m4a", "wav", "flac"].includes(extension)) return "🎵";
  if (extension === "pdf") return "📋";
  return "📎";
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function addFileCard(name, size, href = "") {
  const existing = [...refs.feed.querySelectorAll(".message.file")].find(
    (node) => node.dataset.fileName === name && node.dataset.fileSize === String(size)
  );
  if (existing) return;

  const card = document.createElement("a");
  card.className = "message file";
  card.dataset.fileName = name;
  card.dataset.fileSize = String(size);
  card.href = href || endpoint(
    `/uploads/${encodeURIComponent(name)}?token=${encodeURIComponent(state.token)}`
  );
  card.target = "_blank";
  card.rel = "noopener";
  const icon = document.createElement("span");
  icon.textContent = fileIcon(name);
  const details = document.createElement("div");
  const title = document.createElement("span");
  title.textContent = name;
  const meta = document.createElement("small");
  meta.textContent = `${formatSize(size)} · 下載`;
  details.append(title, meta);
  card.append(icon, details);
  refs.feed.appendChild(card);
  refs.feed.scrollTop = refs.feed.scrollHeight;
}

function uploadFile(file) {
  if (!state.token) {
    showSystem("尚未連接 JARVIS。");
    return;
  }
  const request = new XMLHttpRequest();
  request.open("POST", endpoint("/api/upload"));
  request.setRequestHeader("Authorization", `Bearer ${state.token}`);
  request.upload.onprogress = (event) => {
    if (event.lengthComputable) {
      setStatus(`上傳 ${Math.round(event.loaded / event.total * 100)}%`, false);
    }
  };
  request.onload = () => {
    setStatus("已連線", true);
    try {
      const data = JSON.parse(request.responseText);
      if (request.status === 200 && data.ok) {
        const url = endpoint(
          `/uploads/${encodeURIComponent(data.name)}?token=${encodeURIComponent(state.token)}`
        );
        addFileCard(data.name, data.size, url);
        toast("檔案已送到電腦");
      } else {
        showSystem(data.error || "File upload failed.");
      }
    } catch {
      showSystem("File upload failed.");
    }
  };
  request.onerror = () => {
    showSystem("File upload connection failed.");
    setOnline(false);
  };
  const form = new FormData();
  form.append("file", file);
  request.send(form);
}

function floatToPcm16(samples, sourceRate) {
  let converted = samples;
  if (sourceRate !== 16000) {
    const ratio = sourceRate / 16000;
    const length = Math.round(samples.length / ratio);
    converted = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      converted[index] = samples[Math.min(
        Math.round(index * ratio),
        samples.length - 1
      )];
    }
  }
  const output = new Int16Array(converted.length);
  for (let index = 0; index < converted.length; index += 1) {
    output[index] = Math.max(
      -32768,
      Math.min(32767, Math.round(converted[index] * 32768))
    );
  }
  return output.buffer;
}

function stopVoice() {
  state.audioNode?.disconnect?.();
  state.audioContext?.close?.();
  state.mediaStream?.getTracks().forEach((track) => track.stop());
  if (state.voiceWs && state.voiceWs.readyState < 2) state.voiceWs.close();
  state.audioNode = null;
  state.audioContext = null;
  state.mediaStream = null;
  state.voiceWs = null;
  refs.mic.classList.remove("recording");
}

async function toggleMicrophone() {
  if (state.voiceWs) {
    stopVoice();
    return;
  }
  if (!window.isSecureContext) {
    showSystem("iPhone 麥克風需要 HTTPS。請使用 Tailscale 網址。");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    showSystem("This browser does not expose microphone access.");
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const context = new AudioContext({ sampleRate: 16000 });
    if (context.state === "suspended") await context.resume();
    const socket = new WebSocket(
      socketPath("/ws/phone-audio", state.token)
    );
    socket.binaryType = "arraybuffer";
    socket.onopen = async () => {
      const source = context.createMediaStreamSource(stream);
      const workletCode = [
        "class J{process(i){const c=i[0]?.[0];",
        "if(c)this.port.postMessage(c.slice());return true;}}",
        "registerProcessor('j',J);",
      ].join("");
      const moduleUrl = URL.createObjectURL(
        new Blob([workletCode], { type: "application/javascript" })
      );
      await context.audioWorklet.addModule(moduleUrl);
      URL.revokeObjectURL(moduleUrl);
      const node = new AudioWorkletNode(context, "j");
      node.port.onmessage = (event) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(floatToPcm16(event.data, context.sampleRate));
        }
      };
      source.connect(node);
      state.audioNode = node;
      refs.mic.classList.add("recording");
      showSystem("Voice live — speak now.");
      toast("🎤 Voice live");
    };
    socket.onclose = stopVoice;
    socket.onerror = () => {
      showSystem("Voice connection failed.");
      stopVoice();
    };
    state.voiceWs = socket;
    state.audioContext = context;
    state.mediaStream = stream;
  } catch (error) {
    stopVoice();
    showSystem(
      error.name === "NotAllowedError"
        ? "Microphone denied — allow it in Safari settings."
        : `Microphone error: ${error.message}`
    );
  }
}

refs.pairForm.addEventListener("submit", (event) => {
  event.preventDefault();
  pair(refs.backend.value, refs.pairKey.value);
});

refs.pairKey.addEventListener("input", () => {
  refs.pairKey.value = refs.pairKey.value.toUpperCase().replace(/[^A-Z2-9]/g, "");
  if (refs.pairKey.value.length === 8) {
    refs.pairForm.requestSubmit();
  }
});

refs.command.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendCommand();
  }
});
refs.send.addEventListener("click", sendCommand);
refs.wake.addEventListener("click", wakeJarvis);
refs.mic.addEventListener("click", toggleMicrophone);
refs.audioToggle.addEventListener("click", togglePhoneAudio);
refs.file.addEventListener("change", () => {
  for (const file of refs.file.files) uploadFile(file);
  refs.file.value = "";
});
refs.disconnect.addEventListener("click", () => {
  clearSession();
  refs.pairKey.value = "";
  showPairing();
  setStatus("未連線", false);
});

async function initialize() {
  updatePhoneAudioButton();
  document.addEventListener("pointerdown", () => {
    if (state.phoneAudioEnabled) unlockPhoneAudio();
  }, { once: true });
  const params = new URLSearchParams(location.search);
  const queryBackend = params.get("backend") || "";
  const queryKey = params.get("key") || "";
  const savedBackend = localStorage.getItem(STORAGE.backend) || "";
  state.backend = queryBackend || savedBackend;
  state.token = sessionStorage.getItem(STORAGE.token) || "";
  state.sessionKey = sessionStorage.getItem(STORAGE.key) || "";
  refs.backend.value = state.backend;

  if (!state.backend) {
    showPairing();
    return;
  }

  try {
    state.backend = normalizeBackend(state.backend);
  } catch (error) {
    showPairing(error.message);
    return;
  }

  if (queryKey) {
    await pair(state.backend, queryKey);
    return;
  }

  if (state.token) {
    await initCrypto(state.sessionKey);
    showConnection();
    connectSocket();
    startHealthMonitor();
    return;
  }

  showPairing();
  const resumed = await tryDeviceLogin();
  if (!resumed) await checkHealth();
  if (state.backend && state.backend !== savedBackend) {
    localStorage.setItem(STORAGE.backend, state.backend);
  }
}

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
}

initialize();
