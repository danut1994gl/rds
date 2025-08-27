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
    // Dezactivăm request interception pentru a evita timing issues
    // Vom bloca prin alte metode mai sigure
    try {
      await page.setRequestInterception(false);
      
      // Blocăm prin evaluare în pagină în loc de request interception
      await page.evaluateOnNewDocument(() => {
        // Blocăm Google Analytics
        window.gtag = () => {};
        window.ga = () => {};
        window.GoogleAnalyticsObject = null;
        
        // Blocăm Google Tag Manager
        window.dataLayer = window.dataLayer || [];
        window.google_tag_manager = {};
        
        // Blocăm Google Ads
        window.googletag = { 
          cmd: [], 
          display: () => {}, 
          defineSlot: () => ({ addService: () => {}, setTargeting: () => {} }) 
        };
      });
      
      this.logger.debug(`[${label}] Page interception setup completed (blocking via page evaluation)`);
    } catch (error) {
      this.logger.warn(`[${label}] Failed to setup page interception: ${error.message}`);
    }
  }

  async attachPageLogging(page, label) {
    page.on("console", msg => {
      this.logger.debug(`[${label}][PAGE] ${msg.text()}`);
    });
    
    page.on("response", async res => {
      if (res.url().includes('mono.m3u8')) {
        this.logger.info(`[${label}] Found MONO.M3U8: ${res.url()}`);
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