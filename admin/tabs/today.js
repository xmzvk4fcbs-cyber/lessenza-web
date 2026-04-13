import { registerTab } from "../admin.js";
registerTab("today", async () => {
  const root = document.getElementById("today-list");
  if (root) root.innerHTML = "<p class='muted'>Tab implementation coming next.</p>";
});
