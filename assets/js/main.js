/**
 * Main Application Script
 * Enterprise Admin Panel - Sun PowerTools
 */
"use strict";

(function () {
  const sidebarStorageKey = "admin.sidebarMini";
  const themeStorageKey = "admin-theme";
  const desktopMedia = "(min-width: 992px)";

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback);
    } else {
      callback();
    }
  }

  function isDesktop() {
    return window.matchMedia(desktopMedia).matches;
  }

  function canUseStorage() {
    try {
      const testKey = "__storage_test__";
      window.localStorage.setItem(testKey, "1");
      window.localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      return false;
    }
  }

  const storageAvailable = canUseStorage();

  function getSavedMiniState() {
    if (!storageAvailable) return false;
    return window.localStorage.getItem(sidebarStorageKey) === "true";
  }

  function saveMiniState(isMini) {
    if (storageAvailable) {
      window.localStorage.setItem(sidebarStorageKey, String(isMini));
    }
  }

  function getPreferredTheme() {
    if (storageAvailable) {
      const savedTheme = window.localStorage.getItem(themeStorageKey);
      if (savedTheme === "dark" || savedTheme === "light") {
        return savedTheme;
      }
    }
    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
    return "light";
  }

  function updateThemeControls(theme) {
    const nextTheme = theme === "dark" ? "light" : "dark";
    const label = "Switch to " + (theme === "dark" ? "Light" : "Dark") + " mode";
    const iconClass = theme === "dark" ? "bi bi-sun-fill" : "bi bi-moon-stars-fill";

    const toggles = document.querySelectorAll("[data-theme-toggle], #themeToggle, .theme-toggle");
    toggles.forEach(function (button) {
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
    });

    const icons = document.querySelectorAll("[data-theme-icon], #themeIcon, .theme-toggle i");
    icons.forEach(function (icon) {
      icon.className = iconClass;
    });
  }

  function applyTheme(theme, save) {
    if (theme !== "dark" && theme !== "light") {
      theme = "light";
    }

    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute("data-bs-theme", theme);

    if (save !== false && storageAvailable) {
      try {
        window.localStorage.setItem(themeStorageKey, theme);
      } catch (e) {}
    }

    updateThemeControls(theme);

    try {
      window.dispatchEvent(new CustomEvent("themeChanged", { detail: { theme: theme } }));
    } catch (e) {}
  }

  // Expose global helper
  window.setTheme = function (theme) {
    applyTheme(theme, true);
  };
  window.getTheme = function () {
    return document.documentElement.getAttribute("data-theme") || "light";
  };
  window.toggleTheme = function () {
    const current = window.getTheme();
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next, true);
    return next;
  };

  // Immediate execution: ensure theme matches stored value
  const initialTheme = getPreferredTheme();
  document.documentElement.setAttribute("data-theme", initialTheme);
  document.documentElement.setAttribute("data-bs-theme", initialTheme);

  onReady(function () {
    const body = document.body;
    const sidebarToggle = document.querySelector("[data-sidebar-toggle], .sidebar-toggle");
    const closeButtons = document.querySelectorAll("[data-sidebar-close], .sidebar-backdrop");
    const sidebarLinks = document.querySelectorAll(".sidebar-nav .nav-link");
    const mediaQuery = window.matchMedia(desktopMedia);

    // Initial controls update
    updateThemeControls(initialTheme);

    // Bind Theme Toggle Buttons
    function initThemeToggles() {
      const toggles = document.querySelectorAll("[data-theme-toggle], #themeToggle, .theme-toggle");
      toggles.forEach(function (button) {
        // Prevent duplicate bindings
        if (button.dataset.themeBound) return;
        button.dataset.themeBound = "true";

        button.addEventListener("click", function (e) {
          e.preventDefault();
          window.toggleTheme();
        });
      });
    }
    initThemeToggles();

    // Table Search Helper
    function initTableSearch() {
      const searchInputs = document.querySelectorAll("[data-table-search]");
      searchInputs.forEach(function (input) {
        const tableId = input.getAttribute("data-table-search");
        const table = document.getElementById(tableId);
        if (!table) return;

        input.addEventListener("input", function () {
          const query = input.value.trim().toLowerCase();
          const rows = table.querySelectorAll("tbody tr");
          rows.forEach(function (row) {
            row.hidden = query !== "" && row.textContent.toLowerCase().indexOf(query) === -1;
          });
        });
      });
    }
    initTableSearch();

    // Form Validation Helper
    function initValidation() {
      const forms = document.querySelectorAll(".needs-validation");
      forms.forEach(function (form) {
        form.addEventListener("submit", function (event) {
          if (!form.checkValidity()) {
            event.preventDefault();
            event.stopPropagation();
          }
          form.classList.add("was-validated");
        });
      });
    }
    initValidation();

    // Auto-dismiss Alerts
    function initAutoAlerts() {
      const alerts = document.querySelectorAll(".auto-hide-alert");
      alerts.forEach(function (alert) {
        setTimeout(function () {
          alert.classList.add("fade");
          alert.classList.remove("show");
          setTimeout(function () {
            if (alert.parentNode) alert.remove();
          }, 350);
        }, 3000);
      });
    }
    initAutoAlerts();

    // Centralized Filter Collapse Chevron Toggles
    function initFilterCollapses() {
      const collapses = document.querySelectorAll(".collapse");
      collapses.forEach(function (collapseEl) {
        collapseEl.addEventListener("show.bs.collapse", function () {
          const trigger = document.querySelector('[data-bs-target="#' + collapseEl.id + '"]');
          if (trigger) {
            const icon = trigger.querySelector(".bi-chevron-down, #filterIcon, #userFilterIcon");
            if (icon) {
              icon.classList.remove("bi-chevron-down");
              icon.classList.add("bi-chevron-up");
            }
          }
        });
        collapseEl.addEventListener("hide.bs.collapse", function () {
          const trigger = document.querySelector('[data-bs-target="#' + collapseEl.id + '"]');
          if (trigger) {
            const icon = trigger.querySelector(".bi-chevron-up, #filterIcon, #userFilterIcon");
            if (icon) {
              icon.classList.remove("bi-chevron-up");
              icon.classList.add("bi-chevron-down");
            }
          }
        });
      });
    }
    initFilterCollapses();

    // Centralized Debounced Search for Filter Forms
    function initDebouncedFilterSearch() {
      const searchInputs = document.querySelectorAll(
        "#productSearch, #userSearch, #categorySearch, [data-auto-search], input[name='search']"
      );
      searchInputs.forEach(function (input) {
        const form = input.closest("form");
        if (!form) return;
        let timer;
        input.addEventListener("input", function () {
          clearTimeout(timer);
          timer = setTimeout(function () {
            form.submit();
          }, 500);
        });
      });
    }
    initDebouncedFilterSearch();

    // Centralized Auto-Submit on Filter Select Change
    function initAutoFilterSelects() {
      const filterSelects = document.querySelectorAll(
        ".auto-filter, #userRoleFilter, #userStatusFilter, #statusFilter, select[data-auto-filter]"
      );
      filterSelects.forEach(function (select) {
        select.addEventListener("change", function () {
          const form = select.closest("form");
          if (form) form.submit();
        });
      });
    }
    initAutoFilterSelects();

    // Centralized Status Switch Labels ("Active" / "Inactive")
    function initStatusToggleLabels() {
      const statusToggles = document.querySelectorAll(
        "#createStatus, input[type='checkbox'][id^='editStatus'], [data-status-toggle]"
      );
      statusToggles.forEach(function (chk) {
        const id = chk.id.replace("editStatus", "");
        const label = chk.id === "createStatus"
          ? document.getElementById("createStatusLabel")
          : document.getElementById("editStatusLabel" + id);

        if (label) {
          chk.addEventListener("change", function () {
            label.textContent = this.checked ? "Active" : "Inactive";
          });
        }
      });
    }
    initStatusToggleLabels();

    // Centralized Description Character Counters
    function initDescriptionCounters() {
      const descTextareas = document.querySelectorAll(
        "#createDescription, textarea[id^='editDescription'], [data-char-counter]"
      );
      descTextareas.forEach(function (textarea) {
        const id = textarea.id.replace("editDescription", "");
        const counter = textarea.id === "createDescription"
          ? document.getElementById("createDescriptionCount")
          : document.getElementById("editDescriptionCount" + id);

        if (counter) {
          textarea.addEventListener("input", function () {
            const max = textarea.getAttribute("maxlength") || "200";
            counter.textContent = this.value.length + " / " + max;
          });
        }
      });
    }
    initDescriptionCounters();

    // Profile Dropdown Toggle
    const profileButton = document.getElementById("profileButton");
    const profileMenu = document.getElementById("profileMenu");
    const profileDropdown = document.querySelector(".profile-dropdown");

    if (profileButton && profileMenu) {
      function openProfileMenu() {
        profileMenu.classList.add("show");
        profileButton.classList.add("show");
        profileButton.setAttribute("aria-expanded", "true");
        if (profileDropdown) profileDropdown.classList.add("show");
      }

      function closeProfileMenu() {
        profileMenu.classList.remove("show");
        profileButton.classList.remove("show");
        profileButton.setAttribute("aria-expanded", "false");
        if (profileDropdown) profileDropdown.classList.remove("show");
      }

      profileButton.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        const isOpen = profileMenu.classList.contains("show");
        if (isOpen) {
          closeProfileMenu();
        } else {
          openProfileMenu();
        }
      });

      document.addEventListener("click", function (event) {
        if (profileDropdown && !profileDropdown.contains(event.target)) {
          closeProfileMenu();
        }
      });

      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          closeProfileMenu();
        }
      });
    }

    // Sidebar Toggle
    if (sidebarToggle) {
      function setToggleExpanded() {
        const expanded = isDesktop()
          ? !body.classList.contains("sidebar-mini")
          : body.classList.contains("sidebar-open");
        sidebarToggle.setAttribute("aria-expanded", String(expanded));
      }

      function closeMobileSidebar() {
        body.classList.remove("sidebar-open");
        setToggleExpanded();
      }

      function toggleSidebar() {
        if (isDesktop()) {
          body.classList.toggle("sidebar-mini");
          saveMiniState(body.classList.contains("sidebar-mini"));
        } else {
          body.classList.toggle("sidebar-open");
        }
        setToggleExpanded();
      }

      sidebarToggle.addEventListener("click", toggleSidebar);

      closeButtons.forEach(function (item) {
        item.addEventListener("click", function () {
          if (!isDesktop()) closeMobileSidebar();
        });
      });

      sidebarLinks.forEach(function (item) {
        item.addEventListener("click", function () {
          if (!isDesktop()) closeMobileSidebar();
        });
      });

      // Restore saved mini sidebar on desktop
      if (getSavedMiniState() && isDesktop()) {
        body.classList.add("sidebar-mini");
      }
      setToggleExpanded();

      function handleBreakpointChange() {
        if (isDesktop()) {
          body.classList.remove("sidebar-open");
          if (getSavedMiniState()) {
            body.classList.add("sidebar-mini");
          } else {
            body.classList.remove("sidebar-mini");
          }
        } else {
          body.classList.remove("sidebar-mini");
        }
        setToggleExpanded();
      }

      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", handleBreakpointChange);
      } else if (mediaQuery.addListener) {
        mediaQuery.addListener(handleBreakpointChange);
      }
    }
  });
})();