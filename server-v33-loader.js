const nativeFetch = globalThis.fetch;

globalThis.fetch = (input, init = {}) => {
  const url = String(input || "");
  const base = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const secret = String(process.env.SUPABASE_SECRET_KEY || "");
  if (base && url.startsWith(base) && (secret.startsWith("sb_secret_") || secret.startsWith("sb_publishable_"))) {
    const headers = {...(init.headers || {})};
    delete headers.Authorization;
    return nativeFetch(input, {...init, headers});
  }
  return nativeFetch(input, init);
};

await import("./server-v33.js");
