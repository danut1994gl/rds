const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { createLogger } = require('./logger');
const config = require('./config');

puppeteer.use(StealthPlugin());

class PuppeteerPool {
  constructor() {
    this.browser = null;
    this.pages = [];
    this.availablePages = [];
    this.busyPages = new Set();
    this.logger = createLogger('PuppeteerPool');
    this.isInitialized = false;
  }

  async init() {
    if (this.isInitialized) return;
    
    this.logger.info(`Initializing Puppeteer pool with ${config.puppeteer.poolSize} pages`);
    
    this.browser = await puppeteer.launch({
      headless: config.puppeteer.headless,
      executablePath: config.puppeteer.chromePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--autoplay-policy=no-user-gesture-required",
        "--disable-blink-features=AutomationControlled",
        "--disable-web-security",
        "--disable-features=VizDisplayCompositor,TranslateUI",
        "--disable-ipc-flooding-protection",
        "--disable-extensions",
        "--disable-default-apps"
      ],
      defaultViewport: { width: 1366, height: 850 },
    });

    // Creăm pool-ul de pagini
    for (let i = 0; i < config.puppeteer.poolSize; i++) {
      const page = await this.createPage(`PAGE-${i}`);
      this.pages.push(page);
      this.availablePages.push(page);
    }

    this.isInitialized = true;
    this.logger.info(`Pool initialized successfully with ${this.pages.length} pages`);
  }

  async createPage(label = 'MAIN') {
    const page = await this.browser.newPage();
    page._poolLabel = label;
    
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36");
    await page.setExtraHTTPHeaders({
      "Accept-Language": "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7"
    });
    
    try {
      await page.emulateTimezone("Europe/Bucharest");
    } catch (e) {
      this.logger.warn(`Failed to set timezone for ${label}: ${e.message}`);
    }

    await this.setupPageInterception(page, label);
    await this.attachPageLogging(page, label);
    
    return page;
  }

  async setupPageInterception(page, label) {
    await page.setRequestInterception(true);
    
    const BLOCK_PATTERNS = [
      /(^|\/\/|\.)cdn\.jsdelivr\.net\/npm\/disable-devtool/i,
      /disable-devtool(\.min)?\.js/i,
      /googletagmanager\.com/i,
      /google-analytics\.com/i,
      /googleanalytics\.com/i,
      /gtag\/js/i,
      /gtm\.js/i,
      /ga\.js/i,
      /googlesyndication\.com/i,
      /googleadservices\.com/i,
      /doubleclick\.net/i,
      /googletagservices\.com/i,
      /consent\.google\.com/i,
      /fundingchoicesmessages\.google\.com/i,
      /consentframework\.com/i,
      /fonts\.googleapis\.com/i,
      /fonts\.gstatic\.com/i,
      /gstatic\.com.*\/feedback/i,
      /accounts\.google\.com/i,
      /consent/i,
      /gdpr/i,
      /cookie.*banner/i,
      /privacy.*notice/i
    ];

    const NAV_BLOCK_PATTERNS = [
      /about:blank/,
      /^data:/,
      /^chrome-error:/,
      /consent\.google\.com/i,
      /fundingchoicesmessages\.google\.com/i
    ];

    page.on("request", req => {
      const url = req.url();
      const type = req.resourceType();
      
      // Verificăm dacă frame-ul principal este disponibil
      let isTopNav = false;
      try {
        isTopNav = req.isNavigationRequest() && req.frame() === page.mainFrame();
      } catch (e) {
        // Frame-ul principal nu este încă disponibil
        isTopNav = req.isNavigationRequest();
      }

      if (isTopNav && NAV_BLOCK_PATTERNS.some(pattern => pattern.test(url))) {
        this.logger.debug(`[${label}] Blocked navigation: ${url}`);
        return req.abort();
      }

      if (BLOCK_PATTERNS.some(re => re.test(url))) {
        this.logger.debug(`[${label}] Blocked resource: ${url}`);
        return req.abort();
      }

      const lowerUrl = url.toLowerCase();
      if (lowerUrl.includes('consent') || lowerUrl.includes('gdpr') || 
          lowerUrl.includes('cookie-banner') || lowerUrl.includes('privacy-notice') ||
          lowerUrl.includes('cookiebot') || lowerUrl.includes('cookielaw') || 
          lowerUrl.includes('onetrust')) {
        this.logger.debug(`[${label}] Blocked consent-related: ${url}`);
        return req.abort();
      }

      return req.continue();
    });
  }

  async attachPageLogging(page, label) {
    page.on("console", msg => {
      this.logger.debug(`[${label}][PAGE] ${msg.text()}`);
    });
    
    page.on("response", async res => {
      if (res.url().includes('video.m3u8')) {
        this.logger.info(`[${label}] Found m3u8: ${res.url()}`);
      }
    });
    
    page.on("requestfailed", req => {
      this.logger.warn(`[${label}][FAIL] ${req.method()} ${req.resourceType()} ${req.failure()?.errorText} ${req.url()}`);
    });
  }

  async getPage() {
    if (!this.isInitialized) {
      await this.init();
    }

    if (this.availablePages.length === 0) {
      this.logger.warn('No available pages in pool, waiting...');
      // Așteptăm până se eliberează o pagină
      return new Promise((resolve) => {
        const checkInterval = setInterval(() => {
          if (this.availablePages.length > 0) {
            clearInterval(checkInterval);
            const page = this.availablePages.pop();
            this.busyPages.add(page);
            resolve(page);
          }
        }, 100);
      });
    }

    const page = this.availablePages.pop();
    this.busyPages.add(page);
    return page;
  }

  async releasePage(page) {
    if (this.busyPages.has(page)) {
      this.busyPages.delete(page);
      
      // Curățăm pagina pentru refolosire
      try {
        // Așteptăm să se termine orice operațiune în curs
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Reset la about:blank
        await page.goto('about:blank', { 
          waitUntil: 'domcontentloaded',
          timeout: 5000 
        });
        
        await this.removeConsentElements(page);
      } catch (e) {
        this.logger.warn(`Failed to clean page ${page._poolLabel}: ${e.message}`);
      }
      
      this.availablePages.push(page);
      this.logger.debug(`Page ${page._poolLabel} released back to pool`);
    }
  }

  async removeConsentElements(page) {
    try {
      await page.evaluate(() => {
        const selectors = [
          '[data-google-query-id]', '[data-consent]', '.google-consent', '#google-consent',
          '[class*="cookie"]', '[id*="cookie"]', '[class*="consent"]', '[id*="consent"]',
          '[class*="gdpr"]', '[id*="gdpr"]', '[class*="privacy"]', '[id*="privacy"]',
          '.modal-backdrop', '.overlay', '[class*="overlay"]',
          '#CybotCookiebotDialog', '.CybotCookiebotDialog',
          '#onetrust-consent-sdk', '.onetrust-pc-dark-filter',
          '.cookie-law-info-bar', '.cli-modal-backdrop',
          '[role="dialog"][aria-label*="cookie"]',
          '[role="dialog"][aria-label*="consent"]',
          '[role="dialog"][aria-label*="privacy"]'
        ];

        let removedCount = 0;
        selectors.forEach(selector => {
          try {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
              const text = el.textContent?.toLowerCase() || '';
              const className = el.className?.toLowerCase() || '';
              const id = el.id?.toLowerCase() || '';
              
              if (text.includes('cookie') || text.includes('consent') || 
                  text.includes('privacy') || text.includes('gdpr') ||
                  className.includes('cookie') || className.includes('consent') ||
                  id.includes('cookie') || id.includes('consent')) {
                el.remove();
                removedCount++;
              }
            });
          } catch (e) {}
        });

        // Reset scroll behavior
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

        return removedCount;
      });
    } catch (e) {
      this.logger.warn(`Failed to remove consent elements: ${e.message}`);
    }
  }

  async getPoolStats() {
    return {
      total: this.pages.length,
      available: this.availablePages.length,
      busy: this.busyPages.size,
      initialized: this.isInitialized
    };
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.isInitialized = false;
      this.logger.info('Puppeteer pool closed');
    }
  }
}

module.exports = new PuppeteerPool();