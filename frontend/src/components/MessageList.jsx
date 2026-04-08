export default function MessageList({ busy, messages, messagesEndRef }) {
  return (
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
  );
}
