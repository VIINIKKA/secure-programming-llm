import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  ACCESS_TOKEN_STORAGE_KEY,
  API_2FA_DISABLE_PATH,
  API_2FA_ENABLE_PATH,
  API_2FA_SETUP_PATH,
  API_2FA_STATUS_PATH,
  API_CHAT_PATH,
  API_CHAT_STREAM_PATH,
  API_LOGIN_PATH,
  API_LOGOUT_PATH,
  API_REFRESH_PATH,
  API_REGISTER_PATH,
  DEFAULT_MAX_OUTPUT_TOKENS,
  REFRESH_TOKEN_STORAGE_KEY,
} from "../constants";
import { parseApiError, parseResponseBody, parseSseEvent } from "../lib/api";
import { readSessionValue, writeSessionValue } from "../lib/session";

function createMessageId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createMessage(role, text, id = createMessageId()) {
  return {
    id,
    role,
    text,
    createdAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
}

export function useSecureLlmApp() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [accessToken, setAccessToken] = useState(() => readSessionValue(ACCESS_TOKEN_STORAGE_KEY));
  const [refreshToken, setRefreshToken] = useState(() => readSessionValue(REFRESH_TOKEN_STORAGE_KEY));
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaPending, setMfaPending] = useState(false);
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaUri, setMfaUri] = useState("");
  const [mfaQrDataUrl, setMfaQrDataUrl] = useState("");
  const [mfaManageCode, setMfaManageCode] = useState("");
  const [mfaStatusMsg, setMfaStatusMsg] = useState("");
  const [showSecurityPanel, setShowSecurityPanel] = useState(false);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  useEffect(() => {
    writeSessionValue(ACCESS_TOKEN_STORAGE_KEY, accessToken);
  }, [accessToken]);

  useEffect(() => {
    writeSessionValue(REFRESH_TOKEN_STORAGE_KEY, refreshToken);
  }, [refreshToken]);

  useEffect(() => {
    let isCancelled = false;

    async function buildQrCode() {
      if (!mfaUri) {
        setMfaQrDataUrl("");
        return;
      }

      try {
        const dataUrl = await QRCode.toDataURL(mfaUri, { width: 220, margin: 1 });
        if (!isCancelled) {
          setMfaQrDataUrl(dataUrl);
        }
      } catch {
        if (!isCancelled) {
          setMfaQrDataUrl("");
        }
      }
    }

    buildQrCode();
    return () => {
      isCancelled = true;
    };
  }, [mfaUri]);

  useEffect(() => {
    let isCancelled = false;

    async function restoreSession() {
      // Prefer the access token if this tab still has one.
      if (accessToken) {
        await loadMfaStatus(accessToken);
        setAuthReady(true);
        return;
      }

      if (!refreshToken) {
        setAuthReady(true);
        return;
      }

      try {
        await refreshSession(refreshToken);
      } catch {
        if (!isCancelled) {
          setAccessToken("");
          setRefreshToken("");
        }
      } finally {
        if (!isCancelled) {
          setAuthReady(true);
        }
      }
    }

    restoreSession();
    return () => {
      isCancelled = true;
    };
    // Run once on app mount to restore persisted auth state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addMessage(role, text, id = createMessageId()) {
    setMessages((current) => [...current, createMessage(role, text, id)]);
    return id;
  }

  function setMessageText(id, text) {
    setMessages((current) => current.map((message) => (message.id === id ? { ...message, text } : message)));
  }

  function resetMfaState() {
    // Clear setup data when the signed-in user changes or logs out.
    setMfaRequired(false);
    setMfaEnabled(false);
    setMfaPending(false);
    setMfaSecret("");
    setMfaUri("");
    setMfaQrDataUrl("");
    setMfaManageCode("");
    setMfaStatusMsg("");
    setShowSecurityPanel(false);
  }

  async function loadMfaStatus(token) {
    if (!token) {
      setMfaEnabled(false);
      setMfaPending(false);
      return;
    }

    try {
      const response = await fetch(API_2FA_STATUS_PATH, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await parseResponseBody(response);
      if (!response.ok) {
        return;
      }
      setMfaEnabled(Boolean(data.mfa_enabled));
      setMfaPending(Boolean(data.mfa_pending));
    } catch {
      // Keep chat usable even when MFA status fetch fails.
    }
  }

  async function runAuthRequest(path, fallbackMessage) {
    if (!username.trim() || !password) {
      setError("Username and password are required.");
      return;
    }

    setAuthBusy(true);
    setError("");

    try {
      const payload = {
        username,
        password,
      };

      if (path === API_LOGIN_PATH && otpCode.trim()) {
        payload.otp_code = otpCode.trim();
      }

      const response = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await parseResponseBody(response);
      if (!response.ok) {
        const message = parseApiError(response.status, data, fallbackMessage);
        if (path === API_LOGIN_PATH && (message === "MFA code required." || message === "Invalid MFA code.")) {
          setMfaRequired(true);
          setError(message === "MFA code required." ? "Enter your 6-digit authenticator code." : message);
          return;
        }
        throw new Error(message);
      }

      if (!data.access_token || !data.refresh_token) {
        throw new Error("Authentication response was missing token data.");
      }

      setAccessToken(data.access_token);
      setRefreshToken(data.refresh_token);
      setMfaRequired(false);
      setOtpCode("");
      setPassword("");
      setMessages([]);
      setDraft("");
      await loadMfaStatus(data.access_token);
    } catch (err) {
      setAccessToken("");
      setRefreshToken("");
      setMessages([]);
      resetMfaState();
      setError(err.message || "Unexpected authentication error.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function onLogin(event) {
    event.preventDefault();
    await runAuthRequest(API_LOGIN_PATH, "Login failed.");
  }

  async function onRegister(event) {
    event.preventDefault();
    await runAuthRequest(API_REGISTER_PATH, "Registration failed.");
  }

  async function onLogout() {
    const currentRefresh = refreshToken;
    if (currentRefresh) {
      try {
        await fetch(API_LOGOUT_PATH, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ refresh_token: currentRefresh }),
        });
      } catch {
        // Best-effort logout cleanup on client side.
      }
    }

    setAccessToken("");
    setRefreshToken("");
    setPassword("");
    setOtpCode("");
    setMessages([]);
    setDraft("");
    setError("");
    resetMfaState();
  }

  async function refreshSession(currentRefreshToken) {
    // Refresh tokens rotate, so always store the returned pair.
    const response = await fetch(API_REFRESH_PATH, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        refresh_token: currentRefreshToken,
      }),
    });

    const data = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error(parseApiError(response.status, data, "Session refresh failed."));
    }
    if (!data.access_token || !data.refresh_token) {
      throw new Error("Session refresh failed.");
    }

    setAccessToken(data.access_token);
    setRefreshToken(data.refresh_token);
    await loadMfaStatus(data.access_token);
    return data;
  }

  async function onStartMfaSetup() {
    if (!accessToken) {
      return;
    }

    setMfaBusy(true);
    setMfaStatusMsg("");
    setError("");
    try {
      const response = await fetch(API_2FA_SETUP_PATH, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await parseResponseBody(response);
      if (!response.ok) {
        throw new Error(parseApiError(response.status, data, "Failed to start 2FA setup."));
      }

      setMfaSecret(String(data.secret || ""));
      setMfaUri(String(data.otpauth_uri || ""));
      setMfaPending(true);
      setMfaEnabled(false);
      setMfaStatusMsg("Secret generated. Add it to your authenticator app and verify.");
      setShowSecurityPanel(true);
    } catch (err) {
      setError(err.message || "Failed to start 2FA setup.");
    } finally {
      setMfaBusy(false);
    }
  }

  async function onEnableMfa() {
    if (!accessToken || !mfaManageCode.trim()) {
      setError("Enter a 6-digit code to enable 2FA.");
      return;
    }

    setMfaBusy(true);
    setMfaStatusMsg("");
    setError("");
    try {
      const response = await fetch(API_2FA_ENABLE_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ otp_code: mfaManageCode.trim() }),
      });
      const data = await parseResponseBody(response);
      if (!response.ok) {
        throw new Error(parseApiError(response.status, data, "Failed to enable 2FA."));
      }

      setMfaSecret("");
      setMfaUri("");
      setMfaManageCode("");
      await loadMfaStatus(accessToken);
      setMfaStatusMsg("2FA enabled for your account.");
      setShowSecurityPanel(false);
    } catch (err) {
      setError(err.message || "Failed to enable 2FA.");
    } finally {
      setMfaBusy(false);
    }
  }

  async function onDisableMfa() {
    if (!accessToken || !mfaManageCode.trim()) {
      setError("Enter a 6-digit code to disable 2FA.");
      return;
    }

    setMfaBusy(true);
    setMfaStatusMsg("");
    setError("");
    try {
      const response = await fetch(API_2FA_DISABLE_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ otp_code: mfaManageCode.trim() }),
      });
      const data = await parseResponseBody(response);
      if (!response.ok) {
        throw new Error(parseApiError(response.status, data, "Failed to disable 2FA."));
      }

      setMfaSecret("");
      setMfaUri("");
      setMfaManageCode("");
      await loadMfaStatus(accessToken);
      setMfaStatusMsg("2FA disabled.");
      setShowSecurityPanel(true);
    } catch (err) {
      setError(err.message || "Failed to disable 2FA.");
    } finally {
      setMfaBusy(false);
    }
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
    const assistantMessageId = addMessage("assistant", "");

    try {
      const executeChatStream = async (token) => {
        const response = await fetch(API_CHAT_STREAM_PATH, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            prompt,
            max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
          }),
        });

        if (!response.ok) {
          const data = await parseResponseBody(response);
          const nextError = new Error(parseApiError(response.status, data, "Chat request failed."));
          nextError.statusCode = response.status;
          throw nextError;
        }

        if (!response.body) {
          const fallback = await fetch(API_CHAT_PATH, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              prompt,
              max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
            }),
          });
          const fallbackData = await parseResponseBody(fallback);
          if (!fallback.ok) {
            const nextError = new Error(parseApiError(fallback.status, fallbackData, "Chat request failed."));
            nextError.statusCode = fallback.status;
            throw nextError;
          }
          const fallbackText = String(fallbackData.response || "").trim() || "No response received.";
          setMessageText(assistantMessageId, fallbackText);
          return fallbackText;
        }

        let assistantText = "";
        let streamBuffer = "";
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        setMessageText(assistantMessageId, "Thinking...");

        // Keep incomplete SSE blocks in the buffer until the next chunk arrives.
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          streamBuffer += decoder.decode(value, { stream: true });
          const blocks = streamBuffer.split("\n\n");
          streamBuffer = blocks.pop() || "";

          for (const block of blocks) {
            const eventPayload = parseSseEvent(block);
            if (!eventPayload) {
              continue;
            }
            if (eventPayload.error) {
              throw new Error(eventPayload.error);
            }
            if (eventPayload.delta) {
              assistantText += eventPayload.delta;
              setMessageText(assistantMessageId, assistantText);
            }
          }
        }

        return assistantText;
      };

      let assistantText = "";
      try {
        assistantText = await executeChatStream(accessToken);
      } catch (err) {
        if (err.statusCode === 401 && refreshToken) {
          const refreshed = await refreshSession(refreshToken);
          assistantText = await executeChatStream(refreshed.access_token);
        } else {
          throw err;
        }
      }

      if (!assistantText.trim()) {
        setMessageText(assistantMessageId, "No response received.");
      }
    } catch (err) {
      setMessageText(assistantMessageId, "Request failed.");
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

  function switchAuthMode(nextMode) {
    setError("");
    setMfaRequired(false);
    setOtpCode("");
    setAuthMode(nextMode);
  }

  return {
    auth: {
      accessToken,
      authBusy,
      authMode,
      authReady,
      mfaRequired,
      otpCode,
      password,
      username,
    },
    chat: {
      busy,
      draft,
      messages,
      messagesEndRef,
    },
    error,
    mfa: {
      mfaBusy,
      mfaEnabled,
      mfaManageCode,
      mfaPending,
      mfaQrDataUrl,
      mfaSecret,
      mfaStatusMsg,
      mfaUri,
      showSecurityPanel,
    },
    actions: {
      onComposerKeyDown,
      onDisableMfa,
      onEnableMfa,
      onLogin,
      onLogout,
      onRegister,
      onStartMfaSetup,
      onSubmit,
      setDraft,
      setMfaManageCode,
      setOtpCode,
      setPassword,
      setShowSecurityPanel,
      setUsername,
      switchAuthMode,
    },
  };
}
