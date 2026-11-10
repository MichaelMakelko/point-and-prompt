// Dictation window: listens with the Web Speech API and sends the text to the overlay in the tab that opened it.
// It exists because a page can forbid the microphone for everything inside it; an extension window is not bound by that.

const params = new URLSearchParams(location.search);
const tabId = Number(params.get("tab"));
const langParam = params.get("lang") ?? "";
const lang = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(langParam) ? langParam : "de-DE";

const ui = {
  dot: document.getElementById("dot"),
  status: document.getElementById("statusText"),
  text: document.getElementById("text"),
  retry: document.getElementById("retry"),
  done: document.getElementById("done"),
};

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec;

function showStatus(text, listening) {
  ui.status.textContent = text;
  ui.dot.classList.toggle("off", !listening);
}

async function finish(error) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "pnp:dictate:end", error });
  } catch {
    // The page that asked for dictation is gone, nobody is left to tell.
  }
  window.close();
}

function start() {
  ui.retry.hidden = true;
  showStatus("Ich höre zu …", true);
  let error;
  rec = new Recognition();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (event) => {
    let text = "";
    for (const result of event.results) text += result[0].transcript;
    ui.text.textContent = text;
    // Without the tab there is no field to write into, so the window has no purpose left.
    chrome.tabs.sendMessage(tabId, { type: "pnp:dictate:result", text }).catch(() => window.close());
  };
  rec.onerror = (event) => {
    error = event.error;
  };
  rec.onend = () => {
    rec = undefined;
    if (error === "not-allowed" || error === "service-not-allowed") {
      // Stay open: the user has to allow the microphone for this window before dictation can work.
      showStatus("Mikrofon ist nicht erlaubt", false);
      ui.text.textContent =
        "Chrome hat das Mikrofon für diese Erweiterung nicht freigegeben. Klicke links in der Adresszeile dieses Fensters auf das Symbol, erlaube das Mikrofon und versuche es nochmal.";
      ui.retry.hidden = false;
      return;
    }
    finish(error);
  };
  rec.start();
}

ui.done.addEventListener("click", () => (rec ? rec.stop() : finish()));
ui.retry.addEventListener("click", () => {
  ui.text.textContent = "";
  start();
});

if (!Number.isInteger(tabId) || tabId < 0) {
  showStatus("Diktat-Fenster wurde ohne Tab geöffnet", false);
} else if (!Recognition) {
  finish("Dieser Browser hat keine Spracherkennung");
} else {
  start();
}
