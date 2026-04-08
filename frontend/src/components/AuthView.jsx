function AuthHero() {
  return (
    <aside className="auth-hero">
      <span className="eyebrow">Protected access</span>
      <h2>Sign in to the secure LLM gateway</h2>
      <div className="hero-points">
        <article className="hero-point">
          <span className="hero-point-kicker">JWT</span>
          <strong>Session-backed tokens</strong>
          <p>Refresh and logout stay revocable server-side.</p>
        </article>
        <article className="hero-point">
          <span className="hero-point-kicker">2FA</span>
          <strong>Authenticator app support</strong>
          <p>Add a second factor to login.</p>
        </article>
        <article className="hero-point">
          <span className="hero-point-kicker">Guardrails</span>
          <strong>Secure backend first</strong>
          <p>Checks run before model access.</p>
        </article>
      </div>
    </aside>
  );
}

export default function AuthView({
  authBusy,
  authMode,
  mfaRequired,
  onLogin,
  onRegister,
  otpCode,
  password,
  setOtpCode,
  setPassword,
  setUsername,
  switchAuthMode,
  username,
}) {
  const isLoginMode = authMode === "login";
  const authTitle = isLoginMode ? "Welcome back" : "Create a protected workspace";
  const authBody = isLoginMode ? "Sign in to continue." : "Create a local account.";
  const authSubmitLabel = authBusy ? "Submitting..." : isLoginMode ? "Login" : "Create account";

  return (
    <section className="auth-layout">
      <AuthHero />

      <form onSubmit={isLoginMode ? onLogin : onRegister} className="auth-card auth-form">
        <div className="auth-mode-switch" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            className={`mode-pill ${isLoginMode ? "mode-pill-active" : ""}`}
            onClick={() => switchAuthMode("login")}
            aria-selected={isLoginMode}
          >
            Login
          </button>
          <button
            type="button"
            className={`mode-pill ${!isLoginMode ? "mode-pill-active" : ""}`}
            onClick={() => switchAuthMode("register")}
            aria-selected={!isLoginMode}
          >
            Create account
          </button>
        </div>

        <div className="auth-card-header">
          <span className="eyebrow">{isLoginMode ? "Account access" : "New account"}</span>
          <h2>{authTitle}</h2>
          <p className="auth-note">{authBody}</p>
        </div>

        <div className="field-group">
          <label htmlFor="username">Username</label>
          <input
            id="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="admin"
            autoComplete="username"
          />
        </div>

        <div className="field-group">
          <div className="field-row">
            <label htmlFor="password">Password</label>
            {!isLoginMode ? <span className="field-hint">Use letters and numbers.</span> : null}
          </div>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={isLoginMode ? "Enter password" : "Create a strong password"}
            autoComplete={isLoginMode ? "current-password" : "new-password"}
          />
        </div>

        {isLoginMode && mfaRequired ? (
          <div className="auth-inline-panel">
            <div className="field-row">
              <label htmlFor="otp-code">Authenticator code</label>
              <span className="field-hint">Required for this account</span>
            </div>
            <input
              id="otp-code"
              inputMode="numeric"
              value={otpCode}
              onChange={(event) => setOtpCode(event.target.value)}
              placeholder="123456"
              autoComplete="one-time-code"
            />
          </div>
        ) : null}

        <div className="auth-actions">
          <button type="submit" disabled={authBusy} className="button-primary button-wide">
            {authSubmitLabel}
          </button>
        </div>

        <div className="auth-footer">
          <button
            type="button"
            className="text-button"
            onClick={() => switchAuthMode(isLoginMode ? "register" : "login")}
            disabled={authBusy}
          >
            {isLoginMode ? "Need an account? Create one." : "Already have an account? Login instead."}
          </button>
        </div>
      </form>
    </section>
  );
}
