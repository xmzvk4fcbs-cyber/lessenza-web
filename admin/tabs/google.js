import { registerTab, must, toast, escapeHtml, confirmDialog } from "../admin.js";

const statusEl = document.getElementById("google-status");
const actionsEl = document.getElementById("google-actions");

async function render() {
  statusEl.innerHTML = `<div class="muted">Učitavanje…</div>`;
  actionsEl.innerHTML = "";
  try {
    const r = await must("/api/admin/google-status");
    if (r.connected) {
      renderConnected(r);
    } else if (r.clientConfigured) {
      renderReadyToConnect(r);
    } else {
      renderSetupWizard(r);
    }
  } catch (e) {
    statusEl.innerHTML = `<div style="color:#8B3A3E;">Greška: ${escapeHtml(e.message)}</div>`;
  }
}

function renderConnected(r) {
  const when = r.connectedAt ? new Date(r.connectedAt).toLocaleDateString("sr-Latn", { day: "numeric", month: "long", year: "numeric" }) : "";
  statusEl.innerHTML = `
    <div style="background:rgba(46,107,59,0.08);color:#2E6B3B;padding:0.9rem;border-radius:12px;border:1px solid rgba(46,107,59,0.2);">
      <div style="font-weight:600;margin-bottom:4px;">✓ Povezano sa Google-om</div>
      <div style="font-size:0.88rem;">Nalog: <strong>${escapeHtml(r.email || "(nepoznato)")}</strong>${when ? ` · ${when}` : ""}</div>
      <div class="muted" style="font-size:0.82rem;margin-top:6px;">Novi termini idu automatski u tvoj Google Kalendar, klijenti dobijaju email potvrdu preko tvog Gmail-a.</div>
    </div>`;
  actionsEl.innerHTML = `<button type="button" class="btn btn-ghost" id="gd-disconnect">Prekini vezu</button>`;
  document.getElementById("gd-disconnect").addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Prekinuti vezu sa Google?",
      message: "Novi termini neće ići u Google kalendar dok ne povežeš ponovo. Postojeći ostaju.",
      confirmText: "Prekini vezu",
      variant: "danger",
    });
    if (!ok) return;
    try { await must("/api/admin/google-disconnect", { method: "POST" }); toast("Veza prekinuta.", "success"); render(); }
    catch (e) { toast(e.message, "error"); }
  });
}

function renderReadyToConnect(r) {
  statusEl.innerHTML = `
    <div style="background:rgba(201,169,97,0.1);color:var(--text);padding:0.9rem;border-radius:12px;border:1px solid rgba(201,169,97,0.3);">
      <div style="font-weight:600;margin-bottom:4px;">⏳ Spremno — klikni "Poveži"</div>
      <div style="font-size:0.88rem;">OAuth kredencijali su sačuvani. Sad još jedan klik da daš dozvolu.</div>
    </div>`;
  actionsEl.innerHTML = `
    <a class="btn btn-primary" href="/api/admin/google-start">Poveži Google nalog</a>
    <button type="button" class="btn btn-ghost" id="gd-reconfig">Promijeni OAuth kredencijale</button>
  `;
  document.getElementById("gd-reconfig").addEventListener("click", () => renderSetupWizard(r));
}

function renderSetupWizard(r) {
  const redirectUri = r.redirectUri || "https://lessenza.me/api/admin/google-callback";
  statusEl.innerHTML = `
    <div style="background:var(--cream);padding:1rem;border-radius:12px;border:1px solid var(--champagne-deep);">
      <h3 style="margin:0 0 0.5rem;font-family:'Cormorant Garamond',serif;font-weight:500;color:var(--sage);">Poveži Google za Kalendar i Email</h3>
      <p class="muted" style="font-size:0.88rem;margin:0 0 1rem;">
        Prvi put podešavaš. Traje ~5 minuta. Pratimo korake zajedno.
      </p>

      <ol style="padding-left:1.2rem;line-height:1.9;font-size:0.92rem;">
        <li>
          Klikni da otvoriš Google Cloud Console (novi tab):<br>
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener" class="btn btn-ghost" style="margin:0.35rem 0;font-size:0.85rem;">↗ Otvori Google Console</a>
        </li>
        <li>Gore lijevo: <strong>New Project</strong> → ime: <code>Lessenza</code> → Create.</li>
        <li>
          APIs &amp; Services → <strong>Library</strong> → uključi:
          <ul style="margin:0.25rem 0;"><li>Google Calendar API</li><li>Gmail API</li></ul>
        </li>
        <li>
          OAuth consent screen → <strong>External</strong> → popuni App name &quot;Lessenza&quot;, svoj email → Save &amp; Continue × 3 → dole "Test users" → dodaj svoj email.
        </li>
        <li>
          Credentials → <strong>+ Create Credentials → OAuth client ID</strong> → Application type <strong>Web application</strong>.<br>
          Authorized redirect URIs — kopiraj tačno ovaj link:
          <div style="display:flex;gap:0.5rem;align-items:center;margin:0.4rem 0;">
            <code style="flex:1;padding:8px 10px;background:var(--white-warm);border-radius:8px;font-size:0.82rem;overflow-wrap:anywhere;">${escapeHtml(redirectUri)}</code>
            <button type="button" class="btn btn-ghost" id="gd-copy" style="min-height:36px;padding:0 0.8rem;font-size:0.8rem;">Kopiraj</button>
          </div>
        </li>
        <li>Klik <strong>Create</strong>. Google pokazuje <strong>Client ID</strong> i <strong>Client Secret</strong>.</li>
        <li>
          Kopiraj i zalijepi ih ovdje:
          <div class="field" style="margin-top:0.5rem;">
            <label for="gd-client-id">Client ID</label>
            <input id="gd-client-id" type="text" placeholder="xxxx.apps.googleusercontent.com" autocomplete="off" spellcheck="false">
          </div>
          <div class="field">
            <label for="gd-client-secret">Client Secret</label>
            <input id="gd-client-secret" type="text" placeholder="GOCSPX-..." autocomplete="off" spellcheck="false">
          </div>
        </li>
      </ol>
    </div>
  `;
  actionsEl.innerHTML = `<button type="button" class="btn btn-primary" id="gd-save-creds">Sačuvaj i idi dalje</button>`;

  const copyBtn = document.getElementById("gd-copy");
  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(redirectUri);
        copyBtn.textContent = "Kopirano ✓";
        setTimeout(() => { copyBtn.textContent = "Kopiraj"; }, 1500);
      } catch {
        toast("Ne mogu da kopiram — ručno selektuj link.", "error");
      }
    });
  }

  document.getElementById("gd-save-creds").addEventListener("click", async () => {
    const clientId = document.getElementById("gd-client-id").value.trim();
    const clientSecret = document.getElementById("gd-client-secret").value.trim();
    if (!clientId || !clientSecret) {
      toast("Popuni oba polja.", "error");
      return;
    }
    try {
      await must("/api/admin/google-config", { method: "PUT", body: { clientId, clientSecret } });
      toast("Kredencijali sačuvani.", "success");
      render();
    } catch (e) {
      toast(e.message, "error");
    }
  });
}

registerTab("google", render);
