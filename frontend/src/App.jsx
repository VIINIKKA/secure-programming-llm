import { useEffect, useRef, useState } from "react";

const API_CHAT_PATH = "/api/chat";
const API_CHAT_STREAM_PATH = "/api/chat/stream";
const API_REGISTER_PATH = "/auth/register";
const API_LOGIN_PATH = "/auth/login";
const API_REFRESH_PATH = "/auth/refresh";
const API_LOGOUT_PATH = "/auth/logout";
const API_2FA_STATUS_PATH = "/auth/2fa/status";
const API_2FA_SETUP_PATH = "/auth/2fa/setup";
const API_2FA_ENABLE_PATH = "/auth/2fa/enable";
const API_2FA_DISABLE_PATH = "/auth/2fa/disable";
const DEFAULT_MAX_OUTPUT_TOKENS = 128;
const ACCESS_TOKEN_STORAGE_KEY = "secureLlmAccessToken";
const REFRESH_TOKEN_STORAGE_KEY = "secureLlmRefreshToken";

function readSessionValue(key) {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return window.sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeSessionValue(key, value) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (value) {
      window.sessionStorage.setItem(key, value);
    } else {
      window.sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore storage errors and continue with in-memory auth state.
  }
}

function parseApiError(status, payload, fallback) {
  if (payload && typeof payload === "object") {
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail;
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }
  }
  return fallback || `Request failed with status ${status}.`;
}

async function parseResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return {
    detail: text || `Request failed with status ${response.status}.`,
  };
}

function parseSseEvent(rawBlock) {
  const lines = rawBlock.split("\n");
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  if (dataLines.length === 0) {
    return null;
  }
  const payload = dataLines.map((line) => line.slice(5).trim()).join("\n");
  if (!payload) {
    return null;
  }
  return JSON.parse(payload);
}

export default function App() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [accessToken, setAccessToken] = useState(() => readSessionValue(ACCESS_TOKEN_STORAGE_KEY));
  const [refreshToken, setRefreshToken] = useState(() => readSessionValue(REFRESH_TOKEN_STORAGE_KEY));
  const [messages, setMessages] = useState([]);

  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaPending, setMfaPending] = useState(false);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaUri, setMfaUri] = useState("");
  const [mfaManageCode, setMfaManageCode] = useState("");
  const [mfaStatusMsg, setMfaStatusMsg] = useState("");
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  useEffect(() => {
    writeSessionValue(ACCESS_TOKEN_STORAGE_KEY, accessToken);
  }, [accessToken]);

  useEffect(() => {
    writeSessionValue(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
  }, [refreshToken]);

  useEffect(() => {
    let isCancelled = false;

    async function restoreSession() {
      if (accessToken) {
        await loadMfaStatus(accessToken);
        setAuthReady(true);
        return;
      }
      if (!refreshToken) {
        setAuthReady(true);
        return;
      }

      try {
        await refreshSession(refreshToken);
      } catch {
        if (!isCancelled) {
          setAccessToken("");
          setRefreshToken("");
        }
      } finally {
        if (!isCancelled) {
          setAuthReady(true);
        }
      }
    }

    restoreSession();
    return () => {
      isCancelled = true;
    };
    // Run once on app mount to restore persisted auth state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function createMessageId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function addMessage(role, text, id = createMessageId()) {
    setMessages((current) => [
      ...current,
      {
        id,
        role,
        text,
        createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
    return id;
  }

  function setMessageText(id, text) {
    setMessages((current) => current.map((message) => (message.id === id ? { ...message, text } : message)));
  }

  function resetMfaState() {
    setMfaRequired(false);
    setMfaEnabled(false);
    setMfaPending(false);
    setMfaSecret("");
    setMfaUri("");
    setMfaManageCode("");
    setMfaStatusMsg("");
  }

  async function loadMfaStatus(token) {
    if (!token) {
      setMfaEnabled(false);
      setMfaPending(false);
      return;
    }
    try {
      const response = await fetch(API_2FA_STATUS_PATH, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await parseResponseBody(response);
      if (!response.ok) {
        return;
      }
      setMfaEnabled(Boolean(data.mfa_enabled));
      setMfaPending(Boolean(data.mfa_pending));
    } catch {
      // Keep chat usable even when MFA status fetch fails.
    }
  }

  async function runAuthRequest(path, fallbackMessage) {
    if (!username.trim() || !password) {
      setError("Username and password are required.");
      return;
    }

    setAuthBusy(true);
    setError("");

    try {
      const payload = {
        username,
        password,
      };
      if (path === API_LOGIN_PATH && otpCode.trim()) {
        payload.otp_code = otpCode.trim();
      }
      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await parseResponseBody(response);
      if (!response.ok) {
        const message = parseApiError(response.status, data, fallbackMessage);
        if (path === API_LOGIN_PATH && (message === "MFA code required." || message === "Invalid MFA code.")) {
          setMfaRequired(true);
          setError(message === "MFA code required." ? "Enter your 6-digit authenticator code." : message);
          return;
        }
        throw new Error(message);
      }
      if (!data.access_token || !data.refresh_token) {
        throw new Error("Authentication response was missing token data.");
      }

      setAccessToken(data.access_token);
      setRefreshToken(data.refresh_token);
      setMfaRequired(false);
      setOtpCode("");
      setPassword("");
      setMessages([]);
      setDraft("");
      await loadMfaStatus(data.access_token);
    } catch (err) {
      setAccessToken("");
      setRefreshToken("");
      setMessages([]);
      resetMfaState();
      setError(err.message || "Unexpected authentication error.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function onLogin(event) {
    event.preventDefault();
    await runAuthRequest(API_LOGIN_PATH, "Login failed.");
  }

  async function onRegister(event) {
    event.preventDefault();
    await runAuthRequest(API_REGISTER_PATH, "Registration failed.");
  }

  async function onLogout() {
    const currentRefresh = refreshToken;
    if (currentRefresh) {
      try {
        await fetch(API_LOGOUT_PATH, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ refresh_token: currentRefresh }),
        });
      } catch {
        // Best-effort logout cleanup on client side.
      }
    }
    setAccessToken("");
    setRefreshToken("");
    setPassword("");
    setOtpCode("");
    setMessages([]);
    setDraft("");
    setError("");
    resetMfaState();
  }

  async function refreshSession(currentRefreshToken) {
    const response = await fetch(API_REFRESH_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refresh_token: currentRefreshToken,
      }),
    });
    const data = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error(parseApiError(response.status, data, "Session refresh failed."));
    }
    if (!data.access_token || !data.refresh_token) {
      throw new Error("Session refresh failed.");
    }
    setAccessToken(data.access_token);
    setRefreshToken(data.refresh_token);
    await loadMfaStatus(data.access_token);
    return data;
  }

  async function onStartMfaSetup() {
    if (!accessToken) {
      return;
    }
    setMfaBusy(true);
    setMfaStatusMsg("");
    setError("");
    try {
      const response = await fetch(API_2FA_SETUP_PATH, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await parseResponseBody(response);
      if (!response.ok) {
        throw new Error(parseApiError(response.status, data, "Failed to start 2FA setup."));
      }
      setMfaSecret(String(data.secret || ""));
      setMfaUri(String(data.otpauth_uri || ""));
      setMfaPending(true);
      setMfaEnabled(false);
      setMfaStatusMsg("Secret generated. Add it to your authenticator app and verify.");
    } catch (err) {
      setError(err.message || "Failed to start 2FA setup.");
    } finally {
      setMfaBusy(false);
    }
  }

  async function onEnableMfa() {
    if (!accessToken || !mfaManageCode.trim()) {
      setError("Enter a 6-digit code to enable 2FA.");
      return;
    }
    setMfaBusy(true);
    setMfaStatusMsg("");
    setError("");
    try {
      const response = await fetch(API_2FA_ENABLE_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ otp_code: mfaManageCode.trim() }),
      });
      const data = await parseResponseBody(response);
      if (!response.ok) {
        throw new Error(parseApiError(response.status, data, "Failed to enable 2FA."));
      }
      setMfaSecret("");
      setMfaUri("");
      setMfaManageCode("");
      await loadMfaStatus(accessToken);
      setMfaStatusMsg("2FA enabled for your account.");
    } catch (err) {
      setError(err.message || "Failed to enable 2FA.");
    } finally {
      setMfaBusy(false);
    }
  }

  async function onDisableMfa() {
    if (!accessToken || !mfaManageCode.trim()) {
      setError("Enter a 6-digit code to disable 2FA.");
      return;
    }
    setMfaBusy(true);
    setMfaStatusMsg("");
    setError("");
    try {
      const response = await fetch(API_2FA_DISABLE_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ otp_code: mfaManageCode.trim() }),
      });
      const data = await parseResponseBody(response);
      if (!response.ok) {
        throw new Error(parseApiError(response.status, data, "Failed to disable 2FA."));
      }
      setMfaSecret("");
      setMfaUri("");
      setMfaManageCode("");
      await loadMfaStatus(accessToken);
      setMfaStatusMsg("2FA disabled.");
    } catch (err) {
      setError(err.message || "Failed to disable 2FA.");
    } finally {
      setMfaBusy(false);
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || busy) {
      return;
    }

    if (!accessToken) {
      setError("Please login first.");
      return;
    }

    addMessage("user", prompt);
    setDraft("");
    setBusy(true);
    setError("");
    const assistantMessageId = addMessage("assistant", "");

    try {
      const executeChatStream = async (token) => {
        const response = await fetch(API_CHAT_STREAM_PATH, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            prompt,
            max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
          }),
        });

        if (!response.ok) {
          const data = await parseResponseBody(response);
          const error = new Error(parseApiError(response.status, data, "Chat request failed."));
          error.statusCode = response.status;
          throw error;
        }

        if (!response.body) {
          const fallback = await fetch(API_CHAT_PATH, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              prompt,
              max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
            }),
          });
          const fallbackData = await parseResponseBody(fallback);
          if (!fallback.ok) {
            const error = new Error(parseApiError(fallback.status, fallbackData, "Chat request failed."));
            error.statusCode = fallback.status;
            throw error;
          }
          const fallbackText = String(fallbackData.response || "").trim() || "No response received.";
          setMessageText(assistantMessageId, fallbackText);
          return fallbackText;
        }

        let assistantText = "";
        let streamBuffer = "";
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        setMessageText(assistantMessageId, "Thinking...");

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          streamBuffer += decoder.decode(value, { stream: true });
          const blocks = streamBuffer.split("\n\n");
          streamBuffer = blocks.pop() || "";

          for (const block of blocks) {
            const eventPayload = parseSseEvent(block);
            if (!eventPayload) {
              continue;
            }
            if (eventPayload.error) {
              throw new Error(eventPayload.error);
            }
            if (eventPayload.delta) {
              assistantText += eventPayload.delta;
              setMessageText(assistantMessageId, assistantText);
            }
          }
        }
        return assistantText;
      };

      let assistantText = "";
      try {
        assistantText = await executeChatStream(accessToken);
      } catch (err) {
        if (err.statusCode === 401 && refreshToken) {
          const refreshed = await refreshSession(refreshToken);
          assistantText = await executeChatStream(refreshed.access_token);
        } else {
          throw err;
        }
      }

      if (!assistantText.trim()) {
        setMessageText(assistantMessageId, "No response received.");
      }
    } catch (err) {
      setMessageText(assistantMessageId, "Request failed.");
      setError(err.message || "Unexpected error.");
    } finally {
      setBusy(false);
    }
  }

  function onComposerKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit(event);
    }
  }

  return (
    <main className="app-shell">
      <section className="panel">
        <header className="topbar">
          <div>
            <h1>Secure LLM Assistant</h1>
            <p className="subtitle">JWT protected security layer in front of the model.</p>
          </div>
          {accessToken ? (
            <button type="button" className="button-secondary" onClick={onLogout}>
              Log out
            </button>
          ) : null}
        </header>

        {!authReady ? (
          <section className="auth-form">
            <p className="auth-note">Restoring session...</p>
          </section>
        ) : !accessToken ? (
          <form onSubmit={authMode === "login" ? onLogin : onRegister} className="auth-form">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin"
              autoComplete="username"
            />

            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="password"
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
            />

            {authMode === "login" && mfaRequired ? (
              <>
                <label htmlFor="otp-code">Authenticator code</label>
                <input
                  id="otp-code"
                  inputMode="numeric"
                  value={otpCode}
                  onChange={(event) => setOtpCode(event.target.value)}
                  placeholder="123456"
                  autoComplete="one-time-code"
                />
              </>
            ) : null}

            <div className="auth-actions">
              <button type="submit" disabled={authBusy} className="button-primary">
                {authBusy ? "Submitting..." : authMode === "login" ? "Login" : "Create account"}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  setError("");
                  setMfaRequired(false);
                  setOtpCode("");
                  setAuthMode((current) => (current === "login" ? "register" : "login"));
                }}
                disabled={authBusy}
              >
                {authMode === "login" ? "Need an account?" : "Have an account?"}
              </button>
            </div>
            <span className="auth-note">
              {authMode === "login"
                ? mfaRequired
                  ? "Enter username, password, and 6-digit authenticator code."
                  : "Log in with an existing account."
                : "Password must include letters and numbers."}
            </span>
          </form>
        ) : (
          <section className="chat">
            <section className="mfa-panel">
              <p className="mfa-title">Security: {mfaEnabled ? "2FA enabled" : "2FA disabled"}</p>
              {!mfaEnabled && !mfaPending ? (
                <button type="button" className="button-secondary" onClick={onStartMfaSetup} disabled={mfaBusy}>
                  {mfaBusy ? "Preparing..." : "Set up 2FA"}
                </button>
              ) : null}

              {mfaPending ? (
                <div className="mfa-setup">
                  <p className="auth-note">
                    Add this secret to your authenticator app, then enter a code to enable:
                  </p>
                  <code className="mfa-secret">{mfaSecret}</code>
                  <a href={mfaUri} target="_blank" rel="noreferrer">
                    Open provisioning URI
                  </a>
                </div>
              ) : null}

              {(mfaPending || mfaEnabled) ? (
                <div className="mfa-actions">
                  <input
                    inputMode="numeric"
                    value={mfaManageCode}
                    onChange={(event) => setMfaManageCode(event.target.value)}
                    placeholder="Enter 6-digit code"
                  />
                  {mfaPending ? (
                    <button type="button" className="button-primary" onClick={onEnableMfa} disabled={mfaBusy}>
                      {mfaBusy ? "Verifying..." : "Enable 2FA"}
                    </button>
                  ) : (
                    <button type="button" className="button-secondary" onClick={onDisableMfa} disabled={mfaBusy}>
                      {mfaBusy ? "Updating..." : "Disable 2FA"}
                    </button>
                  )}
                </div>
              ) : null}
              {mfaStatusMsg ? <p className="auth-note">{mfaStatusMsg}</p> : null}
            </section>

            <div className="messages" aria-live="polite">
              {messages.length === 0 ? (
                <div className="empty-state">
                  <p>Start the conversation. Press Enter to send, Shift+Enter for newline.</p>
                </div>
              ) : (
                messages.map((message) => (
                  <article key={message.id} className={`bubble bubble-${message.role}`}>
                    <header>
                      <span className="role">{message.role === "user" ? "You" : "Assistant"}</span>
                      <time>{message.createdAt}</time>
                    </header>
                    <p>{message.text || "..."}</p>
                  </article>
                ))
              )}
              {busy ? <div className="typing">Assistant is thinking...</div> : null}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={onSubmit} className="composer">
              <label htmlFor="prompt" className="sr-only">
                Prompt
              </label>
              <textarea
                id="prompt"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onComposerKeyDown}
                placeholder="Ask something..."
                rows={4}
                required
              />
              <button type="submit" disabled={busy || !draft.trim()} className="button-primary">
                {busy ? "Sending..." : "Send"}
              </button>
            </form>
          </section>
        )}

        {error ? <p className="error">{error}</p> : null}
      </section>
    </main>
  );
}
