// Termini tab — owner's centralised view of "what was booked when".
// Two sections:
//   1. Pristigle rezervacije — bookings CREATED in the last 24h regardless of
//      appointment date, so owner can review + reject new ones quickly.
//   2. Svi termini — searchable list of all bookings in a chosen range,
//      sorted by start time, with the same actions as the schedule cards.
import { registerTab, must, escapeHtml, toast, openModal, closeModal, fmtDateTime, fmtTime, todayKey, plusDays, searchFold } from "../admin.js";

const inboxHost = () => document.getElementById("bookings-inbox");
const listHost = () => document.getElementById("bookings-list");
const statsEl = () => document.getElementById("bookings-stats");
const searchInput = () => document.getElementById("bookings-search");
const badge = () => document.getElementById("bookings-badge");

let cache = []; // raw bookings sorted by startISO ascending
let range = "upcoming"; // upcoming | today | week | month | past
let debounce = null;

function rangeBounds(r) {
  const today = todayKey();
  if (r === "today") return { from: today, to: today };
  if (r === "week") return { from: today, to: plusDays(today, 7) };
  if (r === "month") return { from: today, to: plusDays(today, 30) };
  if (r === "past") return { from: plusDays(today, -30), to: plusDays(today, -1) };
  return { from: today, to: plusDays(today, 90) }; // "upcoming" — next 90d
}

async function load() {
  const { from, to } = rangeBounds(range);
  const data = await must(`/api/admin/appointments?from=${from}&to=${to}`);
  if (data?.error === "google-disconnected") {
    cache = [];
    listHost().innerHTML = `<p class="muted">Google Calendar veza je istekla. Pogledaj baner gore.</p>`;
    inboxHost().innerHTML = "";
    return;
  }
  const appts = data?.appointments || [];
  cache = appts.slice().sort((a, b) => (a.startISO || "").localeCompare(b.startISO || ""));
  renderInbox(appts);
  renderList();
}

function renderInbox(allAppts) {
  // "Pristiglo u zadnja 24h" — uses createdAt if calendar-domain exposes it;
  // else falls back to "booking is for today or future, sorted by start time
  // limited to recent few". Pragmatic for now since not all event responses
  // include creation time.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let recent = (allAppts || []).filter((a) => {
    const created = a.createdAt ? Date.parse(a.createdAt) : NaN;
    return !Number.isNaN(created) && created >= cutoff;
  });
  // If createdAt isn't populated by the backend, fall back to "all bookings
  // for today + future, take the first ones" — better than empty.
  if (recent.length === 0 && allAppts.some((a) => !a.createdAt)) {
    const nowKey = todayKey();
    recent = (allAppts || [])
      .filter((a) => (a.startISO || "").slice(0, 10) >= nowKey)
      .slice(0, 8);
  }
  recent.sort((a, b) => (b.createdAt || b.startISO || "").localeCompare(a.createdAt || a.startISO || ""));

  const b = badge();
  if (b) {
    if (recent.length > 0) { b.hidden = false; b.textContent = String(recent.length); }
    else { b.hidden = true; }
  }
  if (!recent.length) {
    inboxHost().innerHTML = `<p class="muted">Nema novih rezervacija u zadnja 24h.</p>`;
    return;
  }
  inboxHost().innerHTML = recent.map(renderBookingCard).join("");
}

function renderList() {
  const q = searchFold((searchInput()?.value || "").trim());
  const filtered = q
    ? cache.filter((a) => {
        const hay = searchFold([
          a.name || "",
          a.phoneE164 || "",
          a.combinedServicesLabel || a.serviceName || "",
          a.email || "",
          a.note || "",
        ].join(" "));
        return hay.includes(q);
      })
    : cache;
  const s = statsEl();
  if (s) s.textContent = q ? `${filtered.length} od ${cache.length}` : `${cache.length} ${cache.length === 1 ? "termin" : "termina"}`;
  if (!filtered.length) {
    listHost().innerHTML = q
      ? `<p class="muted">Nema termina za "${escapeHtml(q)}".</p>`
      : `<p class="muted">Nema termina u izabranom periodu.</p>`;
    return;
  }
  listHost().innerHTML = filtered.map(renderBookingCard).join("");
}

function renderBookingCard(a) {
  const when = fmtDateTime(a.startISO);
  const time = fmtTime(a.startISO);
  const day = a.startISO ? a.startISO.slice(0, 10) : "";
  const phone = a.phoneE164 || "";
  const svcLabel = a.combinedServicesLabel || a.serviceName || "";
  return `
    <article class="bk-row">
      <div class="bk-row__when">
        <span class="bk-row__date">${escapeHtml(day)}</span>
        <span class="bk-row__time">${escapeHtml(time)}</span>
      </div>
      <div class="bk-row__body">
        <div class="bk-row__name">${escapeHtml(a.name || "—")}</div>
        <div class="bk-row__svc">${escapeHtml(svcLabel)}</div>
        ${phone ? `<div class="bk-row__phone">📞 ${escapeHtml(phone)}</div>` : ""}
        ${a.note ? `<div class="bk-row__note">📝 ${escapeHtml(a.note)}</div>` : ""}
        ${a.email ? `<div class="bk-row__email">✉ ${escapeHtml(a.email)}</div>` : ""}
      </div>
      <div class="bk-row__actions">
        <a class="btn btn-ghost btn--xs" href="/admin/?view=day&anchor=${encodeURIComponent(day)}#schedule">Otvori</a>
        ${phone ? `<a class="btn btn-ghost btn--xs" href="tel:${escapeHtml(phone)}">Pozovi</a>` : ""}
        <button class="btn btn-ghost btn--xs" type="button" data-action="reject" data-event-id="${escapeHtml(a.calendarEventId || "")}" data-name="${escapeHtml(a.name || "")}" data-phone="${escapeHtml(phone)}" data-svc="${escapeHtml(svcLabel)}" data-start="${escapeHtml(a.startISO || "")}">Odbij</button>
        <button class="btn btn-danger btn--xs" type="button" data-action="cancel" data-event-id="${escapeHtml(a.calendarEventId || "")}" data-name="${escapeHtml(a.name || "")}" data-phone="${escapeHtml(phone)}" data-svc="${escapeHtml(svcLabel)}" data-start="${escapeHtml(a.startISO || "")}">Otkaži</button>
      </div>
    </article>
  `;
}

/** Same message-actions modal pattern as today.js / inquiries.js — kept
 *  local so this tab doesn't cross-import. */
function showMessageActions(title, message, whatsappLink, viberLink) {
  const waBtn = whatsappLink ? `<a class="btn btn-primary" href="${whatsappLink}" target="_blank" rel="noopener">📱 WhatsApp</a>` : "";
  const viBtn = viberLink ? `<a class="btn btn-ghost" id="bk-viber-btn" href="${viberLink}">💜 Viber</a>` : "";
  const viHint = viberLink ? `<p class="muted" style="font-size:0.82rem;margin-top:0.5rem;">💜 Viber: otvoriće se ekran „Dodaj kontakt" — tapni Dodaj, pa u polju za poruku drži prst → <strong>Nalijepi</strong> (poruka je već kopirana).</p>` : "";
  openModal(title, `
    <p class="muted" style="font-size:0.88rem;">Poruka za klijentkinju:</p>
    <textarea id="bk-msg-copy" readonly rows="5" style="width:100%;">${escapeHtml(message)}</textarea>
    <div class="stack-card__actions" style="margin-top:0.75rem;flex-wrap:wrap;">
      ${waBtn}
      ${viBtn}
      <button type="button" class="btn btn-ghost" id="bk-msg-copy-btn">📋 Kopiraj</button>
      <button type="button" class="btn btn-ghost" data-close="1">Zatvori</button>
    </div>
    ${viHint}
  `);
  const cbtn = document.getElementById("bk-msg-copy-btn");
  cbtn?.addEventListener("click", async () => {
    const ta = document.getElementById("bk-msg-copy");
    try { await navigator.clipboard.writeText(ta.value); cbtn.textContent = "Kopirano ✓"; }
    catch { ta.select(); document.execCommand("copy"); cbtn.textContent = "Kopirano ✓"; }
    setTimeout(() => { cbtn.textContent = "📋 Kopiraj"; }, 1800);
  });
  // viber://add can't carry the message — copy it on tap so it's ready to paste.
  const vbtn = document.getElementById("bk-viber-btn");
  vbtn?.addEventListener("click", () => {
    const ta = document.getElementById("bk-msg-copy");
    navigator.clipboard?.writeText(ta.value).catch(() => {});
    toast("Poruka kopirana — nalijepi je u Viberu.", "success");
  });
}

// Wire actions (delegated).
function wireActions() {
  document.getElementById("screen-bookings")?.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-action]");
    if (!t) return;
    e.preventDefault();
    const action = t.dataset.action;
    const eventId = t.dataset.eventId;
    const name = t.dataset.name;
    const phone = t.dataset.phone;
    const svc = t.dataset.svc;
    const start = t.dataset.start;
    if (!eventId) { toast("Greška: termin nema ID.", "error"); return; }

    if (action === "cancel") {
      openModal("Otkaži termin", `
        <p><strong>${escapeHtml(svc)}</strong> — ${escapeHtml(name)}<br><span class="muted">${fmtDateTime(start)}</span></p>
        <div class="field">
          <label for="bk-cancel-reason">Razlog (opciono, šalje se klijentu)</label>
          <input id="bk-cancel-reason" type="text" maxlength="200" placeholder="npr. bolest">
        </div>
        <div class="stack-card__actions" style="margin-top:0.75rem;">
          <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
          <button class="btn btn-danger" type="button" id="bk-confirm-cancel">Otkaži termin</button>
        </div>
      `);
      document.getElementById("bk-confirm-cancel").addEventListener("click", async () => {
        const reason = document.getElementById("bk-cancel-reason").value.trim();
        try {
          const r = await must("/api/admin/cancel-booking", { method: "POST", body: { eventId, reason } });
          closeModal();
          toast("Termin otkazan.", "success");
          if (r.message) showMessageActions("Obavijesti klijentkinju", r.message, r.whatsappLink, r.viberLink);
          await load();
        } catch (err) { toast(err.message, "error"); }
      });
      return;
    }

    if (action === "reject") {
      // Same behaviour as Raspored → kartica → Odbij: refuses the booking,
      // optionally blocks the phone so it can't book again. Client gets a
      // "termin nije moguć" message — without an invitation to rebook.
      openModal("Odbij termin", `
        <p><strong>${escapeHtml(svc)}</strong> — ${escapeHtml(name)}<br><span class="muted">${fmtDateTime(start)}</span></p>
        <p class="muted" style="font-size:0.88rem;">Klijent dobija poruku da termin nije moguć, bez poziva na novi termin.</p>
        <label class="check-row" for="bk-reject-block" style="margin-top:0.5rem;">
          <input id="bk-reject-block" type="checkbox">
          <span>Blokiraj ovaj broj da više ne može zakazati</span>
        </label>
        <div class="stack-card__actions" style="margin-top:0.75rem;">
          <button class="btn btn-ghost" type="button" data-close="1">Nazad</button>
          <button class="btn btn-danger" type="button" id="bk-confirm-reject">Odbij termin</button>
        </div>
      `);
      document.getElementById("bk-confirm-reject").addEventListener("click", async () => {
        const block = document.getElementById("bk-reject-block").checked;
        try {
          const r = await must("/api/admin/reject-booking", { method: "POST", body: { eventId, block } });
          closeModal();
          toast(r.blocked ? "Termin odbijen i broj blokiran." : "Termin odbijen.", "success");
          if (r.message) showMessageActions("Obavijesti klijentkinju", r.message, r.whatsappLink, r.viberLink);
          await load();
        } catch (err) { toast(err.message, "error"); }
      });
      return;
    }
  });
}

// Wire search + range chips.
function wireUI() {
  searchInput()?.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(renderList, 150);
  });
  document.querySelectorAll("[data-bookings-range]").forEach((b) => {
    b.addEventListener("click", async () => {
      range = b.dataset.bookingsRange;
      document.querySelectorAll("[data-bookings-range]").forEach((x) => x.classList.toggle("is-active", x === b));
      await load();
    });
  });
}

let _wired = false;
registerTab("bookings-inbox", async () => {
  if (!_wired) {
    wireUI();
    wireActions();
    document.querySelector("[data-bookings-range='upcoming']")?.classList.add("is-active");
    _wired = true;
  }
  await load();
});

// Also refresh badge on dashboard load so owner sees "new bookings" count at a glance
// even if she hasn't opened the Termini tab. Polls every 60s like activity feed.
async function refreshBadge() {
  try {
    const { from, to } = rangeBounds("upcoming");
    const data = await must(`/api/admin/appointments?from=${from}&to=${to}`);
    if (data?.error === "google-disconnected") return;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const appts = data?.appointments || [];
    const recent = appts.filter((a) => {
      const c = a.createdAt ? Date.parse(a.createdAt) : NaN;
      return !Number.isNaN(c) && c >= cutoff;
    });
    const b = badge();
    if (!b) return;
    if (recent.length > 0) { b.hidden = false; b.textContent = String(recent.length); }
    else { b.hidden = true; }
  } catch { /* silent */ }
}
refreshBadge();
setInterval(() => {
  if (document.visibilityState !== "visible") return;
  refreshBadge();
}, 60_000);
