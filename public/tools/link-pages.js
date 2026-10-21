// Shared by reset-password.html and verify-email.html: send the link's token to the API.
const form = document.getElementById("form");
const log = (text, isError = false) => {
  const item = document.createElement("li");
  item.textContent = text;
  if (isError) item.className = "error";
  document.getElementById("log").append(item);
};

const token = new URLSearchParams(location.search).get("token");
if (!token) {
  log("This page needs the link from the email (it ends with ?token=...)", true);
  form.querySelector("button").disabled = true;
}

form.onsubmit = async (event) => {
  event.preventDefault();
  const isReset = form.dataset.action === "reset";
  const body = isReset ? { token, newPassword: new FormData(form).get("newPassword") } : { token };

  const response = await fetch(isReset ? "/auth/reset-password" : "/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  log(json.message ?? json.errors?.map((e) => e.message).join(", "), !json.success);
  if (json.success) form.querySelector("button").disabled = true;
};
