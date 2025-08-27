const { createLogger } = require('./logger');
const config = require('./config');

class M3U8Extractor {
  constructor(puppeteerPool) {
    this.pool = puppeteerPool;
    this.logger = createLogger('M3U8Extractor');
  }

  async extractM3U8(channel) {
    const startTime = Date.now();
    let page = null;
    
    try {
      const targetUrl = config.channels[channel];
      if (!targetUrl) {
        throw new Error(`Canal necunoscut: ${channel}`);
      }

      this.logger.info(`Extragere m3u8 pentru ${channel} din ${targetUrl}`);
      
      page = await this.pool.getPage();
      this.logger.debug(`Folosesc pagina ${page._poolLabel} pentru ${channel}`);

      // Setăm un listener pentru response-uri m3u8
      let m3u8Url = null;
      const responseHandler = async (response) => {
        const url = response.url();
        if (url.includes('video.m3u8') || url.includes('.m3u8')) {
          m3u8Url = url;
          this.logger.info(`M3U8 găsit pentru ${channel}: ${url}`);
        }
      };

      page.on('response', responseHandler);

      // Navigăm la URL cu wait conditions mai robuste
      await page.goto(targetUrl, { 
        waitUntil: ["domcontentloaded", "networkidle0"],
        timeout: config.puppeteer.timeout 
      }).catch(async () => {
        // Dacă networkidle0 fail, încercăm doar cu domcontentloaded
        await page.goto(targetUrl, { 
          waitUntil: "domcontentloaded", 
          timeout: config.puppeteer.timeout 
        });
      });

      // Eliminăm elementele de consent
      await this.removeConsentElements(page);

      // Așteptăm un pic să se încarce pagina
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Încercăm să găsim și să clickăm pe butonul de play
      await this.clickPlayButton(page);

      // Așteptăm să apară linkul m3u8 (maxim 15 secunde)
      let attempts = 0;
      const maxAttempts = 30; // 30 * 500ms = 15 secunde
      
      while (!m3u8Url && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
        
        // Încercăm din nou click pe play la fiecare 5 secunde
        if (attempts % 10 === 0) {
          await this.clickPlayButton(page);
        }
      }

      // Cleanup listener
      page.off('response', responseHandler);

      if (!m3u8Url) {
        // Ultimă încercare - căutăm în network requests
        const networkRequests = await page.evaluate(() => {
          const requests = [];
          if (window.performance && window.performance.getEntriesByType) {
            const entries = window.performance.getEntriesByType('resource');
            for (const entry of entries) {
              if (entry.name.includes('.m3u8') || entry.name.includes('video.m3u8')) {
                requests.push(entry.name);
              }
            }
          }
          return requests;
        });

        if (networkRequests.length > 0) {
          m3u8Url = networkRequests[0];
          this.logger.info(`M3U8 găsit prin performance API pentru ${channel}: ${m3u8Url}`);
        }
      }

      const processingTime = Date.now() - startTime;
      
      if (m3u8Url) {
        this.logger.info(`M3U8 extras cu succes pentru ${channel} în ${processingTime}ms`);
        return {
          success: true,
          channel: channel,
          url: targetUrl,
          m3u8: m3u8Url,
          timestamp: new Date().toISOString(),
          processingTime: processingTime
        };
      } else {
        this.logger.warn(`Nu s-a găsit linkul m3u8 pentru ${channel} în ${processingTime}ms`);
        return {
          success: false,
          channel: channel,
          url: targetUrl,
          error: 'Nu s-a găsit linkul m3u8',
          timestamp: new Date().toISOString(),
          processingTime: processingTime
        };
      }

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(`Eroare la extragerea m3u8 pentru ${channel}: ${error.message}`, { 
        error: error.stack,
        processingTime: processingTime
      });
      
      return {
        success: false,
        channel: channel,
        error: error.message,
        timestamp: new Date().toISOString(),
        processingTime: processingTime
      };
    } finally {
      if (page) {
        await this.pool.releasePage(page);
        this.logger.debug(`Pagina ${page._poolLabel} eliberată pentru ${channel}`);
      }
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
          '.cookie-law-info-bar', '.cli-modal-backdrop'
        ];

        selectors.forEach(selector => {
          try {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
              const text = el.textContent?.toLowerCase() || '';
              if (text.includes('cookie') || text.includes('consent') || 
                  text.includes('privacy') || text.includes('gdpr')) {
                el.remove();
              }
            });
          } catch (e) {}
        });

        // Reset scroll
        if (document.body) {
          document.body.style.overflow = '';
          document.body.classList.remove('modal-open', 'no-scroll');
        }
        if (document.documentElement) {
          document.documentElement.style.overflow = '';
        }
      });
    } catch (e) {
      this.logger.debug(`Eroare la eliminarea elementelor de consent: ${e.message}`);
    }
  }

  async clickPlayButton(page) {
    try {
      const clicked = await page.evaluate(() => {
        const selectors = [
          '.play-button-overlay',
          '.play-button',
          '.play-btn',
          '[class*="play-button"]',
          '[class*="play-overlay"]',
          '.video-overlay',
          '.player-overlay',
          'button[aria-label*="play"]',
          'button[title*="play"]',
          '.vjs-big-play-button'
        ];

        for (const selector of selectors) {
          const elements = document.querySelectorAll(selector);
          for (const btn of elements) {
            if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
              const style = window.getComputedStyle(btn);
              if (style.display !== 'none' && style.visibility !== 'hidden') {
                btn.click();
                console.log(`Clicked on: ${selector}`);
                return true;
              }
            }
          }
        }
        return false;
      });

      if (clicked) {
        this.logger.debug('Click pe butonul play executat');
        
        // Încercăm să pornimăm toate video-urile găsite
        await page.evaluate(() => {
          const videos = Array.from(document.querySelectorAll("video"));
          videos.forEach(async (v) => {
            try {
              v.muted = true;
              await v.play();
            } catch (e) {}
          });
        });
      }
      
      return clicked;
    } catch (error) {
      this.logger.debug(`Eroare la click pe play: ${error.message}`);
      return false;
    }
  }
}

module.exports = M3U8Extractor;