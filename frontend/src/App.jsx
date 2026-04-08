import AppHeader from "./components/AppHeader";
import AuthLoading from "./components/AuthLoading";
import AuthView from "./components/AuthView";
import ChatView from "./components/ChatView";
import { useSecureLlmApp } from "./hooks/useSecureLlmApp";

export default function App() {
  const { actions, auth, chat, error, mfa } = useSecureLlmApp();

  return (
    <main className="app-shell">
      <section className="panel">
        <AppHeader isAuthenticated={Boolean(auth.accessToken)} onLogout={actions.onLogout} />

        {!auth.authReady ? (
          <AuthLoading />
        ) : !auth.accessToken ? (
          <AuthView
            authBusy={auth.authBusy}
            authMode={auth.authMode}
            mfaRequired={auth.mfaRequired}
            onLogin={actions.onLogin}
            onRegister={actions.onRegister}
            otpCode={auth.otpCode}
            password={auth.password}
            setOtpCode={actions.setOtpCode}
            setPassword={actions.setPassword}
            setUsername={actions.setUsername}
            switchAuthMode={actions.switchAuthMode}
            username={auth.username}
          />
        ) : (
          <ChatView
            busy={chat.busy}
            draft={chat.draft}
            messages={chat.messages}
            messagesEndRef={chat.messagesEndRef}
            mfa={mfa}
            onComposerKeyDown={actions.onComposerKeyDown}
            onDisableMfa={actions.onDisableMfa}
            onEnableMfa={actions.onEnableMfa}
            onStartMfaSetup={actions.onStartMfaSetup}
            onSubmit={actions.onSubmit}
            setDraft={actions.setDraft}
            setMfaManageCode={actions.setMfaManageCode}
            setShowSecurityPanel={actions.setShowSecurityPanel}
          />
        )}

        {error ? <p className="error">{error}</p> : null}
      </section>
    </main>
  );
}
