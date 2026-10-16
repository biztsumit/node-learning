// Development tool: the full product-image flow, the same way a real admin frontend would do it.
let token = null;

const $ = (id) => document.getElementById(id);
const log = (text, isError = false) => {
  const item = document.createElement("li");
  item.textContent = text;
  if (isError) item.className = "error";
  $("log").append(item);
};

// Calls OUR API and returns `data`, or throws with the API's error message
const api = async (method, path, body) => {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body)
  });
  const json = await response.json();
  if (!json.success) {
    const details = json.errors ? `: ${json.errors.map((e) => e.message).join(", ")}` : "";
    throw new Error(`${response.status} ${json.message}${details}`);
  }
  return json.data;
};

const showImages = (product) => {
  $("original").src = product.imageUrl ?? "";
  $("thumb").src = product.thumbnailUrl ?? "";
};

const loadProducts = async () => {
  const products = await api("GET", "/products?limit=100&sort=name_asc");
  $("product").replaceChildren(...products.map((p) => new Option(`${p.name} (₹${p.price})`, p.id)));
  $("product").onchange = () => showImages(products.find((p) => p.id === $("product").value));
  showImages(products[0] ?? {});
  for (const id of ["product", "file", "upload", "remove"]) $(id).disabled = false;
};

$("login").onsubmit = async (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  try {
    const result = await api("POST", "/auth/login", { email: form.get("email"), password: form.get("password") });
    if (result.user.role !== "admin") throw new Error("This account is not an admin");
    token = result.token;
    $("who").textContent = `Logged in as ${result.user.name} (admin)`;
    await loadProducts();
  } catch (err) {
    log(err.message, true);
  }
};

$("upload").onclick = async () => {
  const file = $("file").files[0];
  if (!file) return log("Choose an image file first", true);

  try {
    // Step 1: ask our API for a signed upload permission
    const permission = await api("POST", "/admin/uploads/product-image");
    log(`1. Signed permission received (valid until ${new Date(permission.expiresAt).toLocaleTimeString()})`);

    // Step 2: send the file STRAIGHT to Cloudinary (it never passes through our server)
    const form = new FormData();
    for (const [name, value] of Object.entries(permission.fields)) form.append(name, value);
    form.append("file", file);
    const response = await fetch(permission.uploadUrl, { method: "POST", body: form });
    const uploaded = await response.json();
    if (!response.ok) throw new Error(`Cloudinary: ${uploaded.error?.message ?? response.status}`);
    log(`2. Uploaded to Cloudinary: ${uploaded.secure_url} (${Math.round(uploaded.bytes / 1024)} KB, ${uploaded.width}×${uploaded.height})`);

    // Step 3: tell our API to use it for the product
    const product = await api("PATCH", `/products/${$("product").value}/image`, { imageUrl: uploaded.secure_url });
    log(`3. Attached to "${product.name}"`);
    showImages(product);
  } catch (err) {
    log(err.message, true);
  }
};

$("remove").onclick = async () => {
  try {
    const product = await api("PATCH", `/products/${$("product").value}/image`, { imageUrl: null });
    log(`Removed the image from "${product.name}" (and deleted it from Cloudinary if it was ours)`);
    showImages(product);
  } catch (err) {
    log(err.message, true);
  }
};
