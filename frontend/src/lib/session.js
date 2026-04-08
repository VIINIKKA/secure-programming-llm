export function readSessionValue(key) {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    return window.sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

export function writeSessionValue(key, value) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    if (value) {
      window.sessionStorage.setItem(key, value);
      return;
    }
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore storage errors and continue with in-memory auth state.
  }
}
