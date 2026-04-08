export default function AppHeader({ isAuthenticated, onLogout }) {
  return (
    <header className="topbar">
      <div>
        <h1>Secure LLM Assistant</h1>
        <p className="subtitle">JWT and 2FA protected security layer in front of the model.</p>
      </div>
      {isAuthenticated ? (
        <button type="button" className="button-secondary" onClick={onLogout}>
          Log out
        </button>
      ) : null}
    </header>
  );
}
