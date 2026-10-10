(() => {
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const value = (values, key) => typeof values[key] === "string" ? values[key] : "";

  function validateSignUp(values) {
    if (value(values, "full-name").trim().length < 2) return "Enter your full name.";
    if (!emailPattern.test(value(values, "signup-email").trim())) return "Enter a valid email address.";
    if (value(values, "signup-password").length < 8) return "Use a password with at least 8 characters.";
    if (value(values, "signup-password") !== value(values, "confirm-password")) return "Your passwords do not match.";
    return "";
  }

  function validateSignIn(values) {
    if (!emailPattern.test(value(values, "signin-email").trim())) return "Enter a valid email address.";
    if (!value(values, "signin-password")) return "Enter your password.";
    return "";
  }

  function bindForm(formId, errorId, destination, validate) {
    const form = document.getElementById(formId);
    if (!form) return;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = {};
      for (const input of form.querySelectorAll("input")) values[input.id] = input.value;
      const message = validate(values);
      const error = document.getElementById(errorId);
      error.textContent = message;
      if (message) return;
      form.reset();
      window.location.assign(destination);
    });
  }

  window.SiteStripperMockAccount = Object.freeze({ validateSignUp, validateSignIn });
  bindForm("signup-form", "signup-error", "./complete/index.html", validateSignUp);
  bindForm("signin-form", "signin-error", "./complete/index.html", validateSignIn);
})();
