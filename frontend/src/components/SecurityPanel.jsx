function SecurityStateHeader({ mfaEnabled, mfaPending }) {
  const mfaStateLabel = mfaPending ? "Setup in progress" : mfaEnabled ? "2FA enabled" : "2FA disabled";
  const mfaStateDescription = mfaPending
    ? "Scan and verify your authenticator."
    : mfaEnabled
      ? "A code is now required at login."
      : "Add an authenticator code to your login.";

  return (
    <div className="security-panel-header">
      <div>
        <span className="eyebrow">Account security</span>
        <h2>{mfaStateLabel}</h2>
        <p className="auth-note">{mfaStateDescription}</p>
      </div>
      <span className={`status-chip ${mfaEnabled ? "status-chip-strong" : mfaPending ? "status-chip-warn" : ""}`}>
        {mfaStateLabel}
      </span>
    </div>
  );
}

function SessionModelCard() {
  return (
    <article className="security-card">
      <h3>Session model</h3>
      <ul className="security-list">
        <li>Authenticated requests only</li>
        <li>Refresh tokens can be rotated and revoked</li>
        <li>Chat routes enforce route-specific scopes</li>
      </ul>
    </article>
  );
}

function MfaSetupCard({ mfaBusy, mfaManageCode, mfaQrDataUrl, mfaSecret, mfaUri, onEnableMfa, setMfaManageCode }) {
  return (
    <div className="mfa-setup-layout">
      <div className="mfa-qr-card">
        <span className="eyebrow">Step 1</span>
        <h4>Scan the QR code</h4>
        <p className="auth-note">Use any TOTP app.</p>
        {mfaQrDataUrl ? <img className="mfa-qr" src={mfaQrDataUrl} alt="2FA setup QR code" /> : null}
        <a className="mfa-link" href={mfaUri} target="_blank" rel="noreferrer">
          Open provisioning URI
        </a>
      </div>

      <div className="mfa-details-card">
        <span className="eyebrow">Step 2</span>
        <h4>Confirm setup</h4>
        <p className="auth-note">Or paste the secret manually.</p>
        <code className="mfa-secret">{mfaSecret}</code>
        <div className="mfa-actions">
          <input
            inputMode="numeric"
            value={mfaManageCode}
            onChange={(event) => setMfaManageCode(event.target.value)}
            placeholder="Enter 6-digit code"
          />
          <button type="button" className="button-primary" onClick={onEnableMfa} disabled={mfaBusy}>
            {mfaBusy ? "Verifying..." : "Enable 2FA"}
          </button>
        </div>
      </div>
    </div>
  );
}

function MfaEnabledCard({ mfaBusy, mfaManageCode, onDisableMfa, setMfaManageCode }) {
  return (
    <div className="mfa-enabled-panel">
      <div>
        <span className="eyebrow">Manage 2FA</span>
        <h4>Disable with current code</h4>
      </div>
      <div className="mfa-actions">
        <input
          inputMode="numeric"
          value={mfaManageCode}
          onChange={(event) => setMfaManageCode(event.target.value)}
          placeholder="Enter 6-digit code"
        />
        <button type="button" className="button-primary" onClick={onDisableMfa} disabled={mfaBusy}>
          {mfaBusy ? "Verifying..." : "Disable 2FA"}
        </button>
      </div>
    </div>
  );
}

function MfaCard({
  mfaBusy,
  mfaEnabled,
  mfaManageCode,
  mfaPending,
  mfaQrDataUrl,
  mfaSecret,
  mfaStatusMsg,
  mfaUri,
  onDisableMfa,
  onEnableMfa,
  onStartMfaSetup,
  setMfaManageCode,
}) {
  return (
    <article className="security-card security-card-accent">
      <div className="security-card-header">
        <div>
          <h3>Two-factor authentication</h3>
        </div>
        {!mfaEnabled && !mfaPending ? (
          <button type="button" className="button-secondary" onClick={onStartMfaSetup} disabled={mfaBusy}>
            {mfaBusy ? "Preparing..." : "Start setup"}
          </button>
        ) : null}
      </div>

      {mfaPending ? (
        <MfaSetupCard
          mfaBusy={mfaBusy}
          mfaManageCode={mfaManageCode}
          mfaQrDataUrl={mfaQrDataUrl}
          mfaSecret={mfaSecret}
          mfaUri={mfaUri}
          onEnableMfa={onEnableMfa}
          setMfaManageCode={setMfaManageCode}
        />
      ) : null}

      {mfaEnabled ? (
        <MfaEnabledCard
          mfaBusy={mfaBusy}
          mfaManageCode={mfaManageCode}
          onDisableMfa={onDisableMfa}
          setMfaManageCode={setMfaManageCode}
        />
      ) : null}

      {!mfaEnabled && !mfaPending ? (
        <div className="mfa-empty">
          <p className="auth-note">Scan, verify, and 2FA is active.</p>
        </div>
      ) : null}

      {mfaStatusMsg ? (
        <div className="status-banner">
          <p>{mfaStatusMsg}</p>
        </div>
      ) : null}
    </article>
  );
}

export function SecurityCompactBar({ onToggle, showSecurityPanel }) {
  return (
    <div className="security-compact-bar">
      <div className="security-compact-copy">
        <span className="eyebrow">Security</span>
        <strong>2FA enabled</strong>
      </div>
      <div className="security-compact-actions">
        <span className="status-chip status-chip-strong">Protected</span>
        <button type="button" className="text-button" onClick={onToggle}>
          {showSecurityPanel ? "Hide" : "Manage"}
        </button>
      </div>
    </div>
  );
}

export default function SecurityPanel(props) {
  return (
    <section className="security-panel">
      <SecurityStateHeader mfaEnabled={props.mfaEnabled} mfaPending={props.mfaPending} />

      <div className="security-grid">
        <SessionModelCard />
        <MfaCard {...props} />
      </div>
    </section>
  );
}
