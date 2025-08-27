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

      // Setăm un listener pentru response-uri mono.m3u8
      let m3u8Url = null;
      const responseHandler = async (response) => {
        const url = response.url();
        if (url.includes('mono.m3u8')) {
          if (!m3u8Url) { // Luăm primul link găsit
            m3u8Url = url;
            this.logger.info(`MONO.M3U8 găsit pentru ${channel}: ${url}`);
          }
        }
      };

      page.on('response', responseHandler);

      // Navigăm la URL mai simplu pentru a evita timing issues
      await page.goto(targetUrl, { 
        waitUntil: "domcontentloaded",
        timeout: config.puppeteer.timeout 
      });
      
      // Așteptăm ca pagina să fie complet ready
      await page.waitForFunction(() => {
        return document.readyState === 'complete';
      }, { timeout: 10000 }).catch(() => {
        this.logger.debug('Page ready state timeout, continuing...');
      });

      // Eliminăm elementele de consent
      await this.removeConsentElements(page);

      // Așteptăm exact 3 secunde să se încarce pagina complet
      this.logger.debug(`Așteptăm 3 secunde pentru ${channel}...`);
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Clickăm pe div class="play-button-overlay"
      await this.clickPlayButtonOverlay(page);

      // Așteptăm să apară linkul mono.m3u8 (maxim 20 secunde)
      let attempts = 0;
      const maxAttempts = 40; // 40 * 500ms = 20 secunde
      
      while (!m3u8Url && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
        
        // Încercăm din nou click pe play la fiecare 10 secunde
        if (attempts % 20 === 0) {
          this.logger.debug(`Încercare ${attempts/20} - click din nou pe play button...`);
          await this.clickPlayButtonOverlay(page);
        }
      }

      // Cleanup listener
      page.off('response', responseHandler);

      if (!m3u8Url) {
        // Ultimă încercare - căutăm mono.m3u8 în network requests
        const networkRequests = await page.evaluate(() => {
          const requests = [];
          if (window.performance && window.performance.getEntriesByType) {
            const entries = window.performance.getEntriesByType('resource');
            for (const entry of entries) {
              if (entry.name.includes('mono.m3u8')) {
                requests.push(entry.name);
              }
            }
          }
          return requests;
        });

        if (networkRequests.length > 0) {
          m3u8Url = networkRequests[0]; // Primul link găsit
          this.logger.info(`MONO.M3U8 găsit prin performance API pentru ${channel}: ${m3u8Url}`);
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

  async clickPlayButtonOverlay(page) {
    try {
      this.logger.debug('Căutăm div class="play-button-overlay"...');
      
      // Încercăm să clickăm pe div class="play-button-overlay" exact
      const clicked = await page.evaluate(() => {
        const playOverlay = document.querySelector('div.play-button-overlay');
        if (playOverlay) {
          const style = window.getComputedStyle(playOverlay);
          if (style.display !== 'none' && style.visibility !== 'hidden' && 
              playOverlay.offsetWidth > 0 && playOverlay.offsetHeight > 0) {
            playOverlay.click();
            console.log('Clicked on div.play-button-overlay');
            return true;
          }
        }
        return false;
      });

      if (clicked) {
        this.logger.info('✅ Click pe div.play-button-overlay executat cu succes');
        
        // Așteptăm un pic după click
        await new Promise(resolve => setTimeout(resolve, 1000));
        
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
      } else {
        this.logger.warn('⚠️ Nu s-a găsit div.play-button-overlay sau nu este vizibil');
      }
      
      return clicked;
    } catch (error) {
      this.logger.error(`❌ Eroare la click pe div.play-button-overlay: ${error.message}`);
      return false;
    }
  }
}

module.exports = M3U8Extractor;