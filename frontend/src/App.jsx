import { useState } from "react";

const API_CHAT_PATH = "/api/chat";

export default function App() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [accessToken, setAccessToken] = useState("");

  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);

  async function onLogin(event) {
    event.preventDefault();
    setAuthBusy(true);
    setError("");

    try {
      const response = await fetch("/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Login failed.");
      }
      setAccessToken(data.access_token || "");
      setPassword("");
    } catch (err) {
      setAccessToken("");
      setError(err.message || "Unexpected error.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setReply("");

    try {
      const headers = {
        "Content-Type": "application/json",
      };
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const response = await fetch(API_CHAT_PATH, {
        method: "POST",
        headers,
        body: JSON.stringify({
          prompt,
          max_output_tokens: 256,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || "Request failed.");
      }
      setReply(data.response || "");
    } catch (err) {
      setError(err.message || "Unexpected error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="layout">
      <section className="card">
        <h1>Secure LLM Assistant</h1>
        <p className="subtitle">Frontend talks only to FastAPI security layer.</p>

        <form onSubmit={onLogin} className="auth-form">
          <label htmlFor="username">Username (JWT mode)</label>
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
            <button type="submit" disabled={authBusy}>
              {authBusy ? "Logging in..." : "Login"}
            </button>
            {accessToken ? <span className="auth-ok">JWT active</span> : null}
          </div>
        </form>

        <form onSubmit={onSubmit}>
          <label htmlFor="prompt">Prompt</label>
          <textarea
            id="prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ask something..."
            required
          />
          <button type="submit" disabled={busy}>
            {busy ? "Sending..." : "Send"}
          </button>
        </form>

        {error ? <p className="error">{error}</p> : null}
        {reply ? (
          <article className="response">
            <h2>Response</h2>
            <p>{reply}</p>
          </article>
        ) : null}
      </section>
    </main>
  );
}
