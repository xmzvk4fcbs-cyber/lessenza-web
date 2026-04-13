const views = {
  loading: document.getElementById("view-loading"),
  setup: document.getElementById("view-setup"),
  login: document.getElementById("view-login"),
  home: document.getElementById("view-home"),
};

function show(name) {
  for (const [k, el] of Object.entries(views)) {
    el.classList.toggle("hidden", k !== name);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: { "content-type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  return { ok: res.ok, status: res.status, data };
}

async function boot() {
  const { data } = await api("/api/admin/session");
  if (!data.initialized) {
    show("setup");
    return;
  }
  if (data.authenticated) {
    show("home");
    return;
  }
  show("login");
}

document.getElementById("setup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("setup-error");
  err.hidden = true;
  const token = document.getElementById("setup-token").value;
  const password = document.getElementById("setup-password").value;
  const res = await fetch("/api/admin/setup", {
    method: "POST",
    headers: { "content-type": "application/json", "x-setup-token": token },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    err.textContent = body.message || "Neuspjeh pri postavljanju.";
    err.hidden = false;
    return;
  }
  // Immediately try to log in
  const login = await api("/api/admin/login", { method: "POST", body: { password } });
  if (login.ok) show("home");
  else show("login");
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = document.getElementById("login-error");
  err.hidden = true;
  const password = document.getElementById("login-password").value;
  const { ok, data } = await api("/api/admin/login", { method: "POST", body: { password } });
  if (!ok) {
    err.textContent = data.message || "Pogrešna lozinka.";
    err.hidden = false;
    return;
  }
  show("home");
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/admin/logout", { method: "POST" });
  show("login");
});

boot().catch((e) => {
  console.error(e);
});
