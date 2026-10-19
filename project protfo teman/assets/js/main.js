const menuToggle = document.querySelector(".nav__toggle");
const navMenu = document.querySelector(".nav__menu");

menuToggle?.addEventListener("click", () => {
  const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
  menuToggle.setAttribute("aria-expanded", String(!isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Open navigation" : "Close navigation");
  navMenu?.classList.toggle("is-open", !isOpen);
});

navMenu?.querySelectorAll(".nav__link").forEach((link) => {
  link.addEventListener("click", () => {
    navMenu.classList.remove("is-open");
    menuToggle?.setAttribute("aria-expanded", "false");
    menuToggle?.setAttribute("aria-label", "Open navigation");
  });
});

document.querySelectorAll(".work__tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".work__tab").forEach((item) => {
      item.classList.remove("is-active");
      item.setAttribute("aria-selected", "false");
    });
    document.querySelectorAll(".work__panel").forEach((panel) => {
      panel.hidden = panel.id !== tab.dataset.panel;
    });
    tab.classList.add("is-active");
    tab.setAttribute("aria-selected", "true");
  });
});

document.querySelectorAll(".service-item__toggle").forEach((toggle) => {
  toggle.addEventListener("click", () => {
    const service = toggle.closest(".service-item");
    const content = service?.querySelector(".service-item__content");
    const isOpen = toggle.getAttribute("aria-expanded") === "true";

    toggle.setAttribute("aria-expanded", String(!isOpen));
    service?.classList.toggle("is-open", !isOpen);
    if (content) content.hidden = isOpen;
    const icon = toggle.querySelector(".service-item__icon");
    if (icon) icon.textContent = isOpen ? "+" : "−";
  });
});

document.querySelectorAll("[data-copy-email]").forEach((button) => {
  button.addEventListener("click", async () => {
    const email = button.dataset.copyEmail;
    if (!email) return;

    try {
      await navigator.clipboard.writeText(email);
      button.textContent = "Email copied";
    } catch (error) {
      console.error("Could not copy the email address:", error);
      button.textContent = "Copy unavailable — use email link";
    }

    window.setTimeout(() => {
      button.textContent = "Copy email";
    }, 2500);
  });
});

document.querySelectorAll("[data-current-year]").forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});