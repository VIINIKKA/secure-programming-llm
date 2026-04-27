import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ACCESS_TOKEN_STORAGE_KEY,
  API_2FA_STATUS_PATH,
  API_CHAT_STREAM_PATH,
  API_LOGIN_PATH,
  API_REFRESH_PATH,
  REFRESH_TOKEN_STORAGE_KEY,
} from "../constants";
import { useSecureLlmApp } from "./useSecureLlmApp";

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,stub"),
  },
}));

function createJsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function createStreamResponse(chunks) {
  const encoder = new TextEncoder();
  let index = 0;

  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read: async () => {
            if (index >= chunks.length) {
              return { done: true, value: undefined };
            }

            const value = encoder.encode(chunks[index]);
            index += 1;
            return { done: false, value };
          },
        };
      },
    },
  };
}

describe("useSecureLlmApp", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("restores a session with the refresh token on mount", async () => {
    window.sessionStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, "persisted-refresh");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(200, { mfa_enabled: true, mfa_pending: false }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSecureLlmApp());

    await waitFor(() => expect(result.current.auth.authReady).toBe(true));

    expect(result.current.auth.accessToken).toBe("fresh-access");
    expect(window.sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY)).toBe("fresh-access");
    expect(window.sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY)).toBe("fresh-refresh");
    expect(result.current.mfa.mfaEnabled).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(API_REFRESH_PATH);
    expect(fetchMock.mock.calls[1][0]).toBe(API_2FA_STATUS_PATH);
  });

  it("marks login as MFA-protected when the backend requests an OTP code", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(createJsonResponse(401, { detail: "MFA code required." }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSecureLlmApp());

    await waitFor(() => expect(result.current.auth.authReady).toBe(true));

    act(() => {
      result.current.actions.setUsername("alice");
      result.current.actions.setPassword("secret-pass");
    });

    await act(async () => {
      await result.current.actions.onLogin({ preventDefault() {} });
    });

    expect(result.current.auth.mfaRequired).toBe(true);
    expect(result.current.error).toBe("Enter your 6-digit authenticator code.");
    expect(fetchMock.mock.calls[0][0]).toBe(API_LOGIN_PATH);
  });

  it("refreshes the session and retries a streaming chat request after a 401", async () => {
    window.sessionStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, "expired-access");
    window.sessionStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, "old-refresh");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse(200, { mfa_enabled: false, mfa_pending: false }))
      .mockResolvedValueOnce(createJsonResponse(401, { detail: "Session is not active." }))
      .mockResolvedValueOnce(
        createJsonResponse(200, {
          access_token: "fresh-access",
          refresh_token: "fresh-refresh",
        }),
      )
      .mockResolvedValueOnce(createJsonResponse(200, { mfa_enabled: false, mfa_pending: false }))
      .mockResolvedValueOnce(
        createStreamResponse(['data: {"delta":"Recovered response"}\n\n', 'data: {"done":true}\n\n']),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSecureLlmApp());

    await waitFor(() => expect(result.current.auth.authReady).toBe(true));

    act(() => {
      result.current.actions.setDraft("hello");
    });

    await act(async () => {
      await result.current.actions.onSubmit({ preventDefault() {} });
    });

    await waitFor(() => {
      expect(result.current.chat.messages).toHaveLength(2);
      expect(result.current.chat.messages[1].text).toBe("Recovered response");
    });

    expect(result.current.auth.accessToken).toBe("fresh-access");
    expect(fetchMock.mock.calls[1][0]).toBe(API_CHAT_STREAM_PATH);
    expect(fetchMock.mock.calls[4][0]).toBe(API_CHAT_STREAM_PATH);
    expect(fetchMock.mock.calls[4][1].headers.Authorization).toBe("Bearer fresh-access");
    expect(fetchMock.mock.calls[2][0]).toBe(API_REFRESH_PATH);
  });
});
