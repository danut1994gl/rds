// rds-fixed.js
const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const TARGET_URL = process.argv[2] || "https://rds.live/romaniaantena1hd/";
const CHROME = process.env.CHROME_PATH || undefined; // ex: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const HEADLESS = process.env.HEADLESS === "1" ? "new" : false;

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function humanBytes(n) {
  if (!n || isNaN(n)) return "";
  const b = Number(n), u = ["B","KB","MB","GB","TB"];
  const i = Math.floor(Math.log(b)/Math.log(1024));
  return `${(b/1024**i).toFixed(1)}${u[i]}`;
}

async function attachLogging(page, label = "MAIN") {
  page.on("console", msg => console.log(`[${label}][PAGE]`, msg.text()));
  page.on("framenavigated", fr => console.log(`[${label}][NAV]`, fr.url()));
  page.on("response", async res => {
    const req = res.request();
    const h = res.headers() || {};
    const ct = h["content-type"] || "";
    const cl = h["content-length"] || "";
    const len = cl ? humanBytes(cl) : "";
    console.log(`[${label}][RES] ${res.status()} ${req.resourceType().padEnd(10)} ct:${ct}${len ? ` len:${len}` : ""} ${res.url()}`);
  });
  page.on("requestfailed", req => {
    console.log(`[${label}][FAIL] ${req.method()} ${req.resourceType()} ${req.failure()?.errorText} ${req.url()}`);
  });
  page.on("popup", async popup => {
    await popup.bringToFront().catch(()=>{});
    await attachLogging(popup, "POPUP");
    await setupInterception(popup, "POPUP");
  });
}

// Pattern-uri pentru blocarea disable-devtool și toate resursele Google
const BLOCK_PATTERNS = [
  // disable-devtool
  /(^|\/\/|\.)cdn\.jsdelivr\.net\/npm\/disable-devtool/i,
  /disable-devtool(\.min)?\.js/i,
  
  // Google Analytics & Tag Manager
  /googletagmanager\.com/i,
  /google-analytics\.com/i,
  /googleanalytics\.com/i,
  /gtag\/js/i,
  /gtm\.js/i,
  /ga\.js/i,
  
  // Google Ads & Syndication
  /googlesyndication\.com/i,
  /googleadservices\.com/i,
  /doubleclick\.net/i,
  /googletagservices\.com/i,
  
  // Google Consent & GDPR
  /consent\.google\.com/i,
  /fundingchoicesmessages\.google\.com/i,
  /consentframework\.com/i,
  
  // Alte Google servicii
  /fonts\.googleapis\.com/i,
  /fonts\.gstatic\.com/i,
  /gstatic\.com.*\/feedback/i,
  /accounts\.google\.com/i,
  
  // Pattern-uri generale pentru consent
  /consent/i,
  /gdpr/i,
  /cookie.*banner/i,
  /privacy.*notice/i
];

// Pattern-uri URL pentru navigare blocată
const NAV_BLOCK_PATTERNS = [
  /about:blank/,
  /^data:/,
  /^chrome-error:/,
  /consent\.google\.com/i,
  /fundingchoicesmessages\.google\.com/i
];

async function setupInterception(page, label = "MAIN") {
  await page.setRequestInterception(true);
  page.on("request", req => {
    const url = req.url();
    const type = req.resourceType();
    const isTopNav = req.isNavigationRequest() && req.frame() === page.mainFrame();

    // log request-urile
    console.log(`[${label}][REQ] ${req.method()} ${type.padEnd(10)} ${url}`);

    // 1) blocam nav top-level toxice
    if (isTopNav && NAV_BLOCK_PATTERNS.some(pattern => pattern.test(url))) {
      console.log(`[${label}][BLOCK] top-level nav -> ${url}`);
      return req.abort();
    }

    // 2) blocam toate resursele din pattern-uri
    if (BLOCK_PATTERNS.some(re => re.test(url))) {
      console.log(`[${label}][BLOCK] resource -> ${url}`);
      return req.abort();
    }

    // 3) blocam requesturile care conțin cuvinte cheie legate de consent
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('consent') || 
        lowerUrl.includes('gdpr') || 
        lowerUrl.includes('cookie-banner') ||
        lowerUrl.includes('privacy-notice') ||
        lowerUrl.includes('cookiebot') ||
        lowerUrl.includes('cookielaw') ||
        lowerUrl.includes('onetrust')) {
      console.log(`[${label}][BLOCK] consent-related -> ${url}`);
      return req.abort();
    }

    // altfel continuam
    return req.continue();
  });
}

// Funcție pentru eliminarea elementelor de consimțământ din DOM
async function removeConsentElements(page) {
  await page.evaluate(() => {
    // Selectori pentru diverse tipuri de bannere de consent
    const selectors = [
      // Google Consent
      '[data-google-query-id]',
      '[data-consent]',
      '.google-consent',
      '#google-consent',
      
      // Bannere cookie generale
      '[class*="cookie"]',
      '[id*="cookie"]',
      '[class*="consent"]',
      '[id*="consent"]',
      '[class*="gdpr"]',
      '[id*="gdpr"]',
      '[class*="privacy"]',
      '[id*="privacy"]',
      
      // Overlay-uri
      '.modal-backdrop',
      '.overlay',
      '[class*="overlay"]',
      
      // CookieBot
      '#CybotCookiebotDialog',
      '.CybotCookiebotDialog',
      
      // OneTrust
      '#onetrust-consent-sdk',
      '.onetrust-pc-dark-filter',
      
      // Cookie Law Info
      '.cookie-law-info-bar',
      '.cli-modal-backdrop',
      
      // Alte bannere comune
      '[role="dialog"][aria-label*="cookie"]',
      '[role="dialog"][aria-label*="consent"]',
      '[role="dialog"][aria-label*="privacy"]'
    ];

    let removedCount = 0;
    
    selectors.forEach(selector => {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          // Verifică dacă elementul pare să fie un banner de consent
          const text = el.textContent?.toLowerCase() || '';
          const className = el.className?.toLowerCase() || '';
          const id = el.id?.toLowerCase() || '';
          
          if (text.includes('cookie') || 
              text.includes('consent') || 
              text.includes('privacy') ||
              text.includes('gdpr') ||
              className.includes('cookie') ||
              className.includes('consent') ||
              id.includes('cookie') ||
              id.includes('consent')) {
            el.remove();
            removedCount++;
          }
        });
      } catch (e) {
        // Ignoră erorile de selectori
      }
    });

    // Eliminarea stilurilor care ar putea bloca scroll-ul
    const body = document.body;
    const html = document.documentElement;
    
    if (body) {
      body.style.overflow = '';
      body.style.position = '';
      body.classList.remove('modal-open', 'no-scroll');
    }
    
    if (html) {
      html.style.overflow = '';
      html.style.position = '';
      html.classList.remove('modal-open', 'no-scroll');
    }

    console.log(`Removed ${removedCount} consent elements`);
    return removedCount;
  });
}

(async () => {
  const browser = await puppeteer.launch({
    headless: HEADLESS,
    executablePath: CHROME,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-blink-features=AutomationControlled",
      "--disable-web-security",
      "--disable-features=VizDisplayCompositor"
    ],
    defaultViewport: { width: 1366, height: 850 },
  });

  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({
    "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7"
  });
  await page.emulateTimezone("Europe/Bucharest").catch(()=>{});
  
  // Injectăm cod pentru a preveni încărcarea Google services
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    window.chrome = window.chrome || { runtime: {} };
    
    // Blocăm Google Analytics
    window.gtag = () => {};
    window.ga = () => {};
    window.GoogleAnalyticsObject = null;
    
    // Blocăm Google Tag Manager
    window.dataLayer = window.dataLayer || [];
    window.google_tag_manager = {};
    
    // Blocăm Google Ads
    window.googletag = { cmd: [], display: () => {}, defineSlot: () => ({ addService: () => {}, setTargeting: () => {} }) };
    
    // Prevenim încărcarea scripturilor Google
    const originalCreateElement = document.createElement;
    document.createElement = function(tagName) {
      const element = originalCreateElement.call(this, tagName);
      if (tagName.toLowerCase() === 'script') {
        const originalSetAttribute = element.setAttribute;
        element.setAttribute = function(name, value) {
          if (name === 'src' && typeof value === 'string') {
            // Blocăm încărcarea scripturilor Google
            if (value.includes('googletagmanager.com') ||
                value.includes('google-analytics.com') ||
                value.includes('googlesyndication.com') ||
                value.includes('doubleclick.net') ||
                value.includes('googleadservices.com') ||
                value.includes('consent.google.com') ||
                value.includes('fundingchoicesmessages.google.com')) {
              console.log('Blocked Google script:', value);
              return;
            }
          }
          return originalSetAttribute.call(this, name, value);
        };
      }
      return element;
    };
  });

  await attachLogging(page);
  await setupInterception(page); // IMPORTANT: inainte de goto()

  console.log(`Deschid: ${TARGET_URL}`);
  await page.goto(TARGET_URL, { waitUntil: "domcontentloaded", timeout: 120000 });

  // Eliminăm elementele de consent după încărcarea paginii
  setTimeout(async () => {
    await removeConsentElements(page);
  }, 2000);

  // Click automat pe butonul de play după 3 secunde
  setTimeout(async () => {
    try {
      console.log("Căutând butonul de play...");
      
      // Verificăm dacă elementul există și e vizibil
      const playButton = await page.$('.play-button-overlay');
      if (playButton) {
        // Verificăm dacă elementul e vizibil
        const isVisible = await page.evaluate(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && 
                 style.visibility !== 'hidden' && 
                 el.offsetWidth > 0 && 
                 el.offsetHeight > 0;
        }, playButton);

        if (isVisible) {
          console.log("Click pe butonul de play...");
          await playButton.click();
          console.log("✓ Click pe play button executat!");
        } else {
          console.log("Butonul de play nu este vizibil");
        }
      } else {
        // Încercăm să găsim butonul prin alte metode
        const clicked = await page.evaluate(() => {
          // Căutăm elementul direct în DOM
          const playBtn = document.querySelector('.play-button-overlay');
          if (playBtn) {
            playBtn.click();
            return true;
          }

          // Căutăm și alte selectori posibile pentru butonul de play
          const playSelectors = [
            '.play-button',
            '.play-btn',
            '[class*="play-button"]',
            '[class*="play-overlay"]',
            '.video-overlay',
            '.player-overlay',
            'button[aria-label*="play"]',
            'button[title*="play"]'
          ];

          for (const selector of playSelectors) {
            const btn = document.querySelector(selector);
            if (btn) {
              btn.click();
              console.log(`Clicked on: ${selector}`);
              return true;
            }
          }
          return false;
        });

        if (clicked) {
          console.log("✓ Click pe play button executat (metoda alternativă)!");
        } else {
          console.log("⚠ Butonul de play nu a fost găsit");
        }
      }
    } catch (error) {
      console.log("Eroare la click pe play button:", error.message);
    }
  }, 3000);

  // Eliminăm periodic elementele de consent (în caz că se reîncarc)
  setInterval(async () => {
    await removeConsentElements(page);
  }, 5000);

  try {
    await page.evaluate(async () => {
      const vids = Array.from(document.querySelectorAll("video"));
      for (const v of vids) {
        try { v.muted = true; await v.play().catch(()=>{}); } catch {}
      }
    });
  } catch {}

  console.log("Log activ. Google services blocate. Ctrl+C pentru iesire.");
  process.on("SIGINT", async () => { console.log("\nInchidere..."); await browser.close(); process.exit(0); });
  await new Promise(() => {});
})();