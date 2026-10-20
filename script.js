// Set this to your WhatsApp number in international format, without + or spaces.
// Example: const WHATSAPP_NUMBER = "919876543210";
const WHATSAPP_NUMBER = "919960671421";

let products = [
  {id:"turmeric",name:"Fresh turmeric",category:"spice",price:120,unit:"250 g",emoji:"🫚",image:"https://images.pexels.com/photos/31346461/pexels-photo-31346461.jpeg?auto=compress&cs=tinysrgb&w=900",imageAlt:"Fresh turmeric roots; licensed stock photo",imageSource:"stock",color:"#f3e8c8",badge:"FARM FRESH"},
  {id:"papaya",name:"Papaya",category:"fruit",price:60,unit:"per piece",emoji:"🍈",image:"images/WhatsApp Image 2026-10-12 at 3.45.51 PM (1).jpeg",imageAlt:"Papayas growing on a tree in the farm",color:"#f7e2ce",badge:"SEASONAL"},
  {id:"mango",name:"Mangoes",category:"fruit",price:180,unit:"per kg",emoji:"🥭",image:"images/enhanced/mangoes-tree.jpg",imageAlt:"Green mangoes growing on the tree",color:"#f5e8bd",badge:"IN SEASON"},
  {id:"curry-leaves",name:"Curry leaves",category:"spice",price:25,unit:"per bunch",emoji:"🌿",image:"https://images.unsplash.com/photo-1747494113534-d35b4d0ec122?auto=format&fit=crop&w=900&q=80",imageAlt:"Curry leaves on a stem; licensed stock photo",imageSource:"stock",color:"#e1ebd6",badge:"FARM PICK"},
  {id:"lemon",name:"Lemon",category:"fruit",price:40,unit:"per 6 pcs",emoji:"🍋",image:"https://images.unsplash.com/photo-1746449695233-3322395a520d?auto=format&fit=crop&w=900&q=80",imageAlt:"A pile of fresh yellow lemons; licensed stock photo",imageSource:"stock",color:"#f0efc9",badge:"FRESH PICK"},
  {id:"bay-leaf",name:"Bay leaf",category:"spice",price:30,unit:"per bunch",emoji:"🍃",image:"https://images.pexels.com/photos/10487772/pexels-photo-10487772.jpeg?auto=compress&dpr=1&h=750&w=1260",imageAlt:"Bay leaves on a wooden spoon; licensed stock photo",imageSource:"stock",color:"#e0e9d7",badge:"AROMATIC"},
  {id:"starfruit",name:"Starfruit",category:"fruit",price:90,unit:"per kg",emoji:"⭐",image:"https://images.pexels.com/photos/5945753/pexels-photo-5945753.jpeg?auto=compress&dpr=1&h=750&w=1260",imageAlt:"Fresh starfruit; licensed stock photo",imageSource:"stock",color:"#edf0c9",badge:"SEASONAL"},
  {id:"banana",name:"Banana",category:"fruit",price:50,unit:"per dozen",emoji:"🍌",image:"images/enhanced/banana-plant.jpg",imageAlt:"A bunch of bananas growing on the plant",color:"#f4edc7",badge:"FARM FRESH"},
  {id:"pineapple",name:"Pineapple",category:"fruit",price:85,unit:"per piece",emoji:"🍍",image:"images/WhatsApp Image 2026-10-12 at 3.45.45 PM (1).jpeg",imageAlt:"A ripe pineapple with its crown",color:"#f1e5bf",badge:"SWEET PICK"},
  {id:"chikoo",name:"Chikoo",category:"fruit",price:100,unit:"per kg",emoji:"🥔",image:"images/WhatsApp Image 2026-10-12 at 3.45.47 PM (3).jpeg",imageAlt:"Fresh chikoo fruits",color:"#eadbc9",badge:"SEASONAL"},
  {id:"apple-ber",name:"Apple ber",category:"fruit",price:80,unit:"per kg",emoji:"🍏",image:"https://images.pexels.com/photos/18259447/pexels-photo-18259447.jpeg?cs=srgb&dl=pexels-itashumehra-18259447.jpg&fm=jpg",imageAlt:"Harvested Indian jujube fruits; licensed stock photo",imageSource:"stock",color:"#e7edcb",badge:"SEASONAL"},
  {id:"vegetables",name:"Seasonal vegetables",category:"vegetable",price:60,unit:"per farm bag",emoji:"🥬",image:"https://images.pexels.com/photos/16723207/pexels-photo-16723207.jpeg?auto=compress&dpr=1&h=750&w=1260",imageAlt:"Assorted fresh vegetables in a basket; licensed stock photo",imageSource:"stock",color:"#dcebd4",badge:"CHANGES WEEKLY"}
];

const cart = new Map();
const productGrid = document.querySelector("#product-grid");
const cartPanel = document.querySelector("#cart-panel");
const overlay = document.querySelector("#overlay");
const adminLoginLink = document.querySelector(".admin-login-link");
const isLocalEmulatorPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  && new URLSearchParams(window.location.search).get("emulator") === "1";
if (adminLoginLink && isLocalEmulatorPreview) {
  adminLoginLink.href = "admin.html?emulator=1";
}
const rupees = new Intl.NumberFormat("en-IN", {style:"currency",currency:"INR",maximumFractionDigits:0});
const pickupAddress = "101, Neel Arcade, Sector 19, Road No. 17, opposite Shiva Complex, New Panvel, Maharashtra, India";
let coordinates = null;
let activeProductFilter = "all";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"}[char]));
}

function renderProducts(filter=activeProductFilter) {
  activeProductFilter = filter;
  const activeProducts = products.filter(product => product.active !== false);
  const shown = filter === "all" ? activeProducts : activeProducts.filter(product => product.category === filter);
  productGrid.innerHTML = shown.map(product => {
    const outOfStock = product.inStock === false || product.stockQuantity === 0 || product.seasonalAvailability === "unavailable";
    return `
    <article class="product-card" data-product-id="${escapeHtml(product.id)}">
      <div class="product-visual" style="--visual:${escapeHtml(product.color)}"><span class="product-badge">${escapeHtml(product.badge)}</span>${product.image ? `<img class="product-photo" src="${escapeHtml(product.image)}" alt="${escapeHtml(product.imageAlt)}" loading="lazy">${product.imageSource === "stock" ? `<span class="stock-label">Stock photo</span>` : ""}` : `<div class="product-no-photo" aria-hidden="true"><span>${product.category === "fruit" ? "Fruit from the season" : product.category === "spice" ? "Herbs &amp; spices" : "Seasonal farm picks"}</span></div>`}</div>
      <div class="product-info"><div class="product-name-row"><h3 class="product-name">${escapeHtml(product.name)}</h3><span class="product-price">${rupees.format(product.price)}</span></div>
      <p class="product-unit">${escapeHtml(product.unit)}</p><button class="add-button" data-add="${escapeHtml(product.id)}" ${outOfStock ? "disabled" : ""}>${outOfStock ? "Out of stock" : "＋ Add to basket"}</button></div>
    </article>`;
  }).join("");
}

function updateCart() {
  const count = [...cart.values()].reduce((sum, qty) => sum + qty, 0);
  const total = [...cart].reduce((sum, [id, qty]) => sum + products.find(p => p.id === id).price * qty, 0);
  document.querySelector("#cart-count").textContent = count;
  document.querySelector("#cart-title-count").textContent = `(${count})`;
  document.querySelector("#cart-total").textContent = rupees.format(total);
  document.querySelector("#cart-empty").classList.toggle("visible", count === 0);
  document.querySelector("#cart-bottom").classList.toggle("hidden", count === 0);
  document.querySelector("#cart-items").innerHTML = [...cart].map(([id, qty]) => {
    const product = products.find(p => p.id === id);
    return `<div class="cart-line"><div class="cart-thumb" style="--visual:${escapeHtml(product.color)}">${product.image ? `<img src="${escapeHtml(product.image)}" alt="" aria-hidden="true">` : escapeHtml(product.emoji)}</div><div><h3>${escapeHtml(product.name)}</h3><small>${rupees.format(product.price)} · ${escapeHtml(product.unit)}</small><div class="quantity-control"><button data-qty="${escapeHtml(id)}" data-change="-1" aria-label="Remove one ${escapeHtml(product.name)}">−</button><span>${qty}</span><button data-qty="${escapeHtml(id)}" data-change="1" aria-label="Add one ${escapeHtml(product.name)}">+</button><button class="remove-item" data-remove="${escapeHtml(id)}">Remove</button></div></div><span class="cart-line-total">${rupees.format(product.price * qty)}</span></div>`;
  }).join("");
  renderCheckoutSummary();
}

function renderCheckoutSummary() {
  const summary = document.querySelector("#checkout-summary");
  const total = [...cart].reduce((sum, [id, qty]) => sum + products.find(p => p.id === id).price * qty, 0);
  document.querySelector("#checkout-total").textContent = rupees.format(total);
  summary.innerHTML = [...cart].map(([id, qty]) => {
    const product = products.find(p => p.id === id);
    return `<div class="summary-line"><span>${escapeHtml(product.name)} × ${qty}<small>${rupees.format(product.price)} each · ${escapeHtml(product.unit)}</small></span><strong>${rupees.format(product.price * qty)}</strong></div>`;
  }).join("");
}

function readProfile() {
  return window.firebaseCustomerProfile || null;
}

function setCartOpen(open) {
  if (open) {
    document.querySelector("#checkout-view").hidden = true;
    document.querySelector("#cart-items").hidden = false;
    document.querySelector("#cart-bottom").classList.toggle("hidden", cart.size === 0);
  }
  cartPanel.classList.toggle("open", open);
  cartPanel.setAttribute("aria-hidden", String(!open));
  overlay.hidden = !open;
  requestAnimationFrame(() => overlay.classList.toggle("open", open));
  document.body.style.overflow = open ? "hidden" : "";
  if (open) document.querySelector("#cart-close").focus();
}

document.querySelector("#filters").addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");
  if (!button) return;
  document.querySelectorAll(".filter-chip").forEach(chip => chip.classList.toggle("active", chip === button));
  renderProducts(button.dataset.filter);
});

productGrid.addEventListener("click", event => {
  const button = event.target.closest("[data-add]");
  if (!button) return;
  const id = button.dataset.add;
  const product = products.find(item => item.id === id);
  if (!product || product.active === false || product.inStock === false || product.seasonalAvailability === "unavailable") return;
  if (Number.isSafeInteger(product.stockQuantity) && (cart.get(id) || 0) >= product.stockQuantity) {
    button.textContent = "Stock limit reached";
    return;
  }
  cart.set(id, (cart.get(id) || 0) + 1);
  updateCart();
  const oldText = button.textContent;
  button.textContent = "✓ Added";
  window.setTimeout(() => { if (button.isConnected) button.textContent = oldText; }, 900);
});

document.querySelector("#cart-items").addEventListener("click", event => {
  const qtyButton = event.target.closest("[data-qty]");
  const removeButton = event.target.closest("[data-remove]");
  if (removeButton) cart.delete(removeButton.dataset.remove);
  if (qtyButton) {
    const id = qtyButton.dataset.qty;
    const next = (cart.get(id) || 0) + Number(qtyButton.dataset.change);
    if (next <= 0) cart.delete(id); else cart.set(id, next);
  }
  updateCart();
});

document.querySelector("#cart-trigger").addEventListener("click", () => setCartOpen(true));
document.querySelector("#cart-close").addEventListener("click", () => setCartOpen(false));
overlay.addEventListener("click", () => setCartOpen(false));
document.querySelector("#continue-shopping").addEventListener("click", () => { setCartOpen(false); document.querySelector("#shop").scrollIntoView(); });
document.querySelector("#checkout-start").addEventListener("click", () => {
  if (!cart.size) return;
  document.querySelector("#cart-items").hidden = true;
  document.querySelector("#cart-empty").classList.remove("visible");
  document.querySelector("#cart-bottom").classList.add("hidden");
  document.querySelector("#checkout-view").hidden = false;
  const profile = readProfile();
  if (profile) {
    document.querySelector("#checkout-name").value = profile.name || "";
    document.querySelector("#checkout-mobile").value = profile.mobile || "";
  }
  renderCheckoutSummary();
});
document.querySelector("#checkout-back").addEventListener("click", () => {
  document.querySelector("#checkout-view").hidden = true;
  document.querySelector("#cart-items").hidden = false;
  document.querySelector("#cart-bottom").classList.remove("hidden");
  updateCart();
});

document.querySelectorAll("input[name='fulfilment']").forEach(input => input.addEventListener("change", () => {
  const delivery = input.value === "delivery" && input.checked;
  document.querySelector("#delivery-fields").hidden = !delivery;
  document.querySelector("#pickup-address").hidden = delivery;
  document.querySelectorAll("#delivery-fields input").forEach(field => { field.required = delivery; });
}));

document.querySelector("#location-button").addEventListener("click", () => {
  const status = document.querySelector("#location-status");
  if (!navigator.geolocation) {
    status.textContent = "Location is not available in this browser. Please enter your address manually.";
    return;
  }
  status.textContent = "Requesting location permission…";
  navigator.geolocation.getCurrentPosition(position => {
    coordinates = {latitude:position.coords.latitude, longitude:position.coords.longitude};
    const output = document.querySelector("#coordinates");
    output.textContent = `Current location: ${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`;
    output.hidden = false;
    status.textContent = "Location saved for this order. Please check and complete your address fields below.";
  }, error => {
    coordinates = null;
    const messages = {
      1:"Location permission was denied. Please enter or correct your address manually.",
      2:"Your location could not be determined. Please enter your address manually.",
      3:"The location request timed out. Please enter your address manually."
    };
    status.textContent = messages[error.code] || "Location is unavailable. Please enter your address manually.";
    document.querySelector("#coordinates").hidden = true;
  }, {enableHighAccuracy:false,timeout:10000,maximumAge:60000});
});

document.querySelector("#checkout-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!cart.size) return;
  if (WHATSAPP_NUMBER.includes("X")) {
    window.alert("Please add your WhatsApp number in script.js first (WHATSAPP_NUMBER near the top). Use country code 91 and no + or spaces.");
    return;
  }
  const form = new FormData(event.currentTarget);
  const fulfilment = form.get("fulfilment");
  const lines = [...cart].map(([id, qty]) => {
    const product = products.find(p => p.id === id);
    return `• ${product.name} — ${qty} × ${product.unit} (${rupees.format(product.price * qty)})`;
  });
  const total = [...cart].reduce((sum, [id, qty]) => sum + products.find(p => p.id === id).price * qty, 0);
  const addressLines = fulfilment === "pickup"
    ? [`Pickup from Pratima’s Farm`, pickupAddress]
    : [`Home delivery`, `Flat/house: ${form.get("flat")}`, `Building: ${form.get("building")}`, `Area: ${form.get("area")}`, `City: ${form.get("city")}`, `PIN code: ${form.get("pin")}`];
  if (fulfilment !== "pickup" && coordinates) addressLines.push(`Coordinates: ${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`);
  const message = [
    `Hello Pratima’s Farm! I'd like to place an order.`,
    `Customer: ${form.get("customerName")}`,
    `Mobile: ${form.get("mobile")}`,
    ``, `Items:`, ...lines,
    ``, `Estimated total: ${rupees.format(total)} (no delivery fee included)`,
    ``, `Fulfilment and address:`, ...addressLines,
    ``, `Please confirm availability and delivery/pickup timing.`
  ].join("\n");
  window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");

  const recordStatus = document.querySelector("#whatsapp-record-status");
  recordStatus.hidden = false;
  if (typeof window.recordWhatsAppEnquiry !== "function") {
    recordStatus.textContent = "WhatsApp draft opened. This request was not recorded in the admin dashboard; it is not a confirmed order.";
    return;
  }
  const orderPayload = {
    customerName: String(form.get("customerName") || ""),
    mobile: String(form.get("mobile") || ""),
    fulfilment,
    items: [...cart].map(([id, quantity]) => ({id, quantity})),
    address: fulfilment === "pickup" ? {} : {
      flat: String(form.get("flat") || ""),
      building: String(form.get("building") || ""),
      area: String(form.get("area") || ""),
      city: String(form.get("city") || ""),
      pin: String(form.get("pin") || ""),
      coordinates
    }
  };
  recordStatus.textContent = "WhatsApp draft opened. Recording this as an unconfirmed enquiry…";
  window.recordWhatsAppEnquiry(orderPayload).then(result => {
    recordStatus.textContent = `Unconfirmed WhatsApp enquiry recorded for review (reference ${result.enquiryId}). The WhatsApp message still needs to be sent by you.`;
  }).catch(error => {
    const code = typeof error?.code === "string" ? ` (${error.code})` : "";
    recordStatus.textContent = `WhatsApp draft opened, but this enquiry was not recorded in the admin dashboard${code}. It is not a confirmed order.`;
  });
});

// Simple contact and farm-visit shortcuts; they use the same number as checkout.
document.querySelectorAll("[data-whatsapp-message]").forEach(button => {
  button.addEventListener("click", () => {
    if (WHATSAPP_NUMBER.includes("X")) {
      window.alert("Please add your WhatsApp number in script.js first (WHATSAPP_NUMBER near the top). Use country code 91 and no + or spaces.");
      return;
    }
    const message = button.dataset.whatsappMessage;
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  });
});

const farmVideo = document.querySelector("#farm-video-player");
const farmVideoPlay = document.querySelector("#farm-video-play");
farmVideoPlay.addEventListener("click", () => farmVideo.play());
farmVideo.addEventListener("play", () => { farmVideoPlay.hidden = true; });
farmVideo.addEventListener("pause", () => { farmVideoPlay.hidden = false; });
farmVideo.addEventListener("ended", () => { farmVideoPlay.hidden = false; });

const accountBackdrop = document.querySelector("#account-backdrop");
document.querySelector("#account-trigger").addEventListener("click", () => {
  const profile = readProfile();
  if (profile) {
    document.querySelector("#account-name").value = profile.name || "";
  }
  accountBackdrop.hidden = false;
});
document.querySelector("#account-close").addEventListener("click", () => { accountBackdrop.hidden = true; });
accountBackdrop.addEventListener("click", event => { if (event.target === accountBackdrop) accountBackdrop.hidden = true; });

document.addEventListener("keydown", event => {
  if (event.key === "Escape") { setCartOpen(false); accountBackdrop.hidden = true; }
});

// Open farm and flower gallery images in a simple accessible lightbox.
const photoLightbox = document.querySelector("#photo-lightbox");
const lightboxImage = photoLightbox.querySelector("img");
const lightboxCaption = photoLightbox.querySelector("figcaption");
function closePhotoLightbox() {
  photoLightbox.hidden = true;
  document.body.classList.remove("lightbox-open");
}
document.querySelectorAll(".gallery-grid, .flower-grid, .love-grid").forEach(gallery => {
  gallery.addEventListener("click", event => {
    const image = event.target.closest("img");
    if (!image) return;
    const figure = image.closest("figure, .love-card");
    lightboxImage.src = image.currentSrc || image.src;
    lightboxImage.alt = image.alt;
    lightboxCaption.textContent = figure?.querySelector("figcaption")?.textContent || figure?.querySelector("h3")?.textContent || image.alt;
    photoLightbox.hidden = false;
    document.body.classList.add("lightbox-open");
    photoLightbox.querySelector(".lightbox-close").focus();
  });
});
photoLightbox.querySelector(".lightbox-close").addEventListener("click", closePhotoLightbox);
photoLightbox.addEventListener("click", event => { if (event.target === photoLightbox) closePhotoLightbox(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") closePhotoLightbox(); });

document.querySelector("#year").textContent = new Date().getFullYear();
const savedProfile = readProfile();
if (savedProfile?.name) document.querySelector("#checkout-name").value = savedProfile.name;
renderProducts();
updateCart();

function applyCatalogUpdates(rows) {
  if (!Array.isArray(rows)) return;
  const merged = new Map(products.map(product => [product.id, product]));
  for (const product of rows) {
    if (product && typeof product.id === "string") {
      merged.set(product.id, {...(merged.get(product.id) || {}), ...product});
    }
  }
  products = [...merged.values()];
  renderProducts(activeProductFilter);
  updateCart();
}

window.addEventListener("munfarm-catalog-ready", event => applyCatalogUpdates(event.detail?.products));
if (Array.isArray(window.munfarmCatalogProducts)) applyCatalogUpdates(window.munfarmCatalogProducts);
