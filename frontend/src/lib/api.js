export function parseApiError(status, payload, fallback) {
  if (payload && typeof payload === "object") {
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail;
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }
  }

  return fallback || `Request failed with status ${status}.`;
}

export async function parseResponseBody(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const text = await response.text();
  return {
    detail: text || `Request failed with status ${response.status}.`,
  };
}

export function parseSseEvent(rawBlock) {
  const lines = rawBlock.split("\n");
  const dataLines = lines.filter((line) => line.startsWith("data:"));
  if (dataLines.length === 0) {
    return null;
  }

  const payload = dataLines.map((line) => line.slice(5).trim()).join("\n");
  if (!payload) {
    return null;
  }

  return JSON.parse(payload);
}
