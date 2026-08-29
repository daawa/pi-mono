const slides = Array.from(document.querySelectorAll(".slide"));
const counter = document.querySelector("#counter");
const progress = document.querySelector("#progress-bar");
const deck = document.querySelector("#deck");
let current = 0;

function fitDeck() {
  if (document.body.classList.contains("overview")) return;
  const scale = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
  deck.style.transform = `translate(-50%, -50%) scale(${scale})`;
}

function show(index, updateHash = true) {
  current = (index + slides.length) % slides.length;
  slides.forEach((slide, slideIndex) => slide.classList.toggle("active", slideIndex === current));
  counter.textContent = `${current + 1} / ${slides.length}`;
  progress.style.width = `${((current + 1) / slides.length) * 100}%`;
  document.title = `${slides[current].dataset.title} — pi-agent-core`;
  if (updateHash) history.replaceState(null, "", `#${current + 1}`);
}

function toggleOverview(force) {
  const enabled = force ?? !document.body.classList.contains("overview");
  document.body.classList.toggle("overview", enabled);
  if (!enabled) fitDeck();
}

document.querySelector("#prev").addEventListener("click", () => show(current - 1));
document.querySelector("#next").addEventListener("click", () => show(current + 1));
document.querySelector("#overview").addEventListener("click", () => toggleOverview());

slides.forEach((slide, index) => {
  slide.addEventListener("click", () => {
    if (!document.body.classList.contains("overview")) return;
    toggleOverview(false);
    show(index);
  });
});

window.addEventListener("resize", fitDeck);
window.addEventListener("keydown", (event) => {
  if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) {
    event.preventDefault();
    show(current + 1);
  } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
    event.preventDefault();
    show(current - 1);
  } else if (event.key === "Home") {
    show(0);
  } else if (event.key === "End") {
    show(slides.length - 1);
  } else if (event.key.toLowerCase() === "o") {
    toggleOverview();
  } else if (event.key === "Escape" && document.body.classList.contains("overview")) {
    toggleOverview(false);
  }
});

const initial = Number.parseInt(location.hash.slice(1), 10);
show(Number.isFinite(initial) ? Math.min(Math.max(initial - 1, 0), slides.length - 1) : 0, false);
fitDeck();
