export default function AuthLoading() {
  return (
    <section className="auth-loading">
      <div className="auth-card auth-card-loading">
        <span className="eyebrow">Session</span>
        <h2>Restoring session</h2>
        <p className="auth-note">Checking saved login state.</p>
      </div>
    </section>
  );
}
