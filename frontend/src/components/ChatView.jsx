import MessageList from "./MessageList";
import SecurityPanel, { SecurityCompactBar } from "./SecurityPanel";

function Composer({ busy, draft, onComposerKeyDown, onSubmit, setDraft }) {
  return (
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
  );
}

export default function ChatView({
  busy,
  draft,
  messages,
  messagesEndRef,
  mfa,
  onComposerKeyDown,
  onDisableMfa,
  onEnableMfa,
  onStartMfaSetup,
  onSubmit,
  setDraft,
  setMfaManageCode,
  setShowSecurityPanel,
}) {
  const shouldShowFullSecurityPanel = !mfa.mfaEnabled || mfa.mfaPending || mfa.showSecurityPanel;

  return (
    <section className="chat">
      {mfa.mfaEnabled && !mfa.mfaPending ? (
        <SecurityCompactBar
          onToggle={() => setShowSecurityPanel((current) => !current)}
          showSecurityPanel={mfa.showSecurityPanel}
        />
      ) : null}

      {shouldShowFullSecurityPanel ? (
        <SecurityPanel
          mfaBusy={mfa.mfaBusy}
          mfaEnabled={mfa.mfaEnabled}
          mfaManageCode={mfa.mfaManageCode}
          mfaPending={mfa.mfaPending}
          mfaQrDataUrl={mfa.mfaQrDataUrl}
          mfaSecret={mfa.mfaSecret}
          mfaStatusMsg={mfa.mfaStatusMsg}
          mfaUri={mfa.mfaUri}
          onDisableMfa={onDisableMfa}
          onEnableMfa={onEnableMfa}
          onStartMfaSetup={onStartMfaSetup}
          setMfaManageCode={setMfaManageCode}
        />
      ) : null}

      <MessageList busy={busy} messages={messages} messagesEndRef={messagesEndRef} />
      <Composer busy={busy} draft={draft} onComposerKeyDown={onComposerKeyDown} onSubmit={onSubmit} setDraft={setDraft} />
    </section>
  );
}
