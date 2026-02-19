import { useState } from "react";

const API_CHAT_PATH = "/api/chat";

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setReply("");

    try {
      const response = await fetch(API_CHAT_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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
