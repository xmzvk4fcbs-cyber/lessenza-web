import { registerTab, must, toast, escapeHtml } from "../admin.js";

const statusEl = document.getElementById("google-status");
const actionsEl = document.getElementById("google-actions");

async function render() {
  statusEl.textContent = "Učitavanje…";
  actionsEl.innerHTML = "";
  try {
    const r = await must("/api/admin/google-status");
    if (!r.clientConfigured) {
      statusEl.innerHTML = `
        <div style="background:#FBEDEC;color:#8B3A3E;padding:0.75rem;border-radius:10px;">
          ⚠️ OAuth credentials nisu postavljene u Netlify env.<br>
          Pročitaj "Kako podesiti" ispod — treba dodati <code>GOOGLE_OAUTH_CLIENT_ID</code> i <code>GOOGLE_OAUTH_CLIENT_SECRET</code>.
        </div>`;
      return;
    }
    if (r.connected) {
      const when = r.connectedAt ? new Date(r.connectedAt).toLocaleDateString("sr-Latn", { day: "numeric", month: "long", year: "numeric" }) : "";
      statusEl.innerHTML = `
        <div style="background:rgba(46,107,59,0.08);color:#2E6B3B;padding:0.75rem;border-radius:10px;">
          ✓ Povezano: <strong>${escapeHtml(r.email || "(nepoznato)")}</strong>${when ? ` · ${when}` : ""}
        </div>`;
      actionsEl.innerHTML = `<button type="button" class="btn btn-ghost" id="gd-disconnect">Prekini vezu</button>`;
      document.getElementById("gd-disconnect").addEventListener("click", async () => {
        if (!confirm("Prekinuti vezu sa Google? Novi termini neće ići u kalendar dok se ne povežeš ponovo.")) return;
        try {
          await must("/api/admin/google-disconnect", { method: "POST" });
          toast("Veza prekinuta.", "success");
          render();
        } catch (e) {
          toast(e.message, "error");
        }
      });
    } else {
      statusEl.innerHTML = `<div style="color:var(--text-light);">Nije povezano. Klikni "Poveži Google" ispod.</div>`;
      actionsEl.innerHTML = `<a class="btn btn-primary" href="/api/admin/google-start">Poveži Google</a>`;
    }
  } catch (e) {
    statusEl.innerHTML = `<div style="color:#8B3A3E;">Greška: ${escapeHtml(e.message)}</div>`;
  }
}

registerTab("google", render);
