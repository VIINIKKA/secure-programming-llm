import { useEffect, useRef, useState } from "react";

const API_CHAT_PATH = "/api/chat";
const API_LOGIN_PATH = "/auth/login";
const DEFAULT_MAX_OUTPUT_TOKENS = 256;

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

export default function App() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [messages, setMessages] = useState([]);

  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  function createMessageId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function addMessage(role, text) {
    setMessages((current) => [
      ...current,
      {
        id: createMessageId(),
        role,
        text,
        createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      },
    ]);
  }

  async function onLogin(event) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("Username and password are required.");
      return;
    }

    setAuthBusy(true);
    setError("");

    try {
      const response = await fetch(API_LOGIN_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });

      const data = await parseResponseBody(response);
      if (!response.ok) {
        throw new Error(parseApiError(response.status, data, "Login failed."));
      }

      setAccessToken(data.access_token || "");
      setPassword("");
      setMessages([]);
      setDraft("");
    } catch (err) {
      setAccessToken("");
      setMessages([]);
      setError(err.message || "Unexpected login error.");
    } finally {
      setAuthBusy(false);
    }
  }

  function onLogout() {
    setAccessToken("");
    setPassword("");
    setMessages([]);
    setDraft("");
    setError("");
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

    try {
      const response = await fetch(API_CHAT_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          prompt,
          max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
        }),
      });

      const data = await parseResponseBody(response);
      if (!response.ok) {
        if (response.status === 401) {
          setAccessToken("");
          throw new Error("Session expired. Please login again.");
        }
        throw new Error(parseApiError(response.status, data, "Chat request failed."));
      }

      addMessage("assistant", data.response || "No response received.");
    } catch (err) {
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

        {!accessToken ? (
          <form onSubmit={onLogin} className="auth-form">
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
              autoComplete="current-password"
            />

            <div className="auth-actions">
              <button type="submit" disabled={authBusy} className="button-primary">
                {authBusy ? "Logging in..." : "Login"}
              </button>
              <span className="auth-note">Use your backend `AUTH_USERNAME` and `AUTH_PASSWORD`.</span>
            </div>
          </form>
        ) : (
          <section className="chat">
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
                    <p>{message.text}</p>
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
