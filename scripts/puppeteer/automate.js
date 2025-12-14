const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;

/**
 * Adrian Cantrill Course Transcript Automation
 * Phase 1: Setup and Authentication
 */
class TranscriptAutomator {
  constructor(options = {}) {
    this.debug = options.debug || false;
    this.headless = options.headless !== false; // Default to headless mode
    this.dataDir = path.join(__dirname, 'data');
    this.configDir = path.join(__dirname, 'config');
    this.cookiesPath = path.join(this.dataDir, 'cookies.json');
    this.browser = null;
    this.page = null;
  }

  /**
   * Initialize the browser and create necessary directories
   */
  async init() {
    try {
      // Create data directory if it doesn't exist
      await fs.mkdir(this.dataDir, { recursive: true });
      console.log('Data directory created/verified');

      // Launch browser with recommended settings
      this.browser = await puppeteer.launch({
        headless: this.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ],
        defaultViewport: {
          width: 1920,
          height: 1080
        }
      });

      // Create a new page
      this.page = await this.browser.newPage();
      console.log('Browser launched successfully');

      // Set user agent to avoid bot detection
      await this.page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      );

      return true;
    } catch (error) {
      console.error('Error initializing browser:', error);
      return false;
    }
  }

  /**
   * Load cookies from file and set them in the browser
   */
  async loadCookies() {
    try {
      // Check if cookies file exists
      const cookiesExists = await fs.access(this.cookiesPath)
        .then(() => true)
        .catch(() => false);

      if (!cookiesExists) {
        console.log('No cookies file found. You need to create one first.');
        console.log('Create a file at:', this.cookiesPath);
        console.log('With the following format:');
        console.log(JSON.stringify([
          {
            "name": "example_cookie",
            "value": "example_value",
            "domain": "learn.cantrill.io"
          }
        ], null, 2));
        return false;
      }

      // Load cookies from file
      const cookiesData = await fs.readFile(this.cookiesPath, 'utf8');
      const cookies = JSON.parse(cookiesData);

      // Set cookies in the browser
      await this.page.setCookie(...cookies);
      console.log(`Loaded ${cookies.length} cookies`);

      return true;
    } catch (error) {
      console.error('Error loading cookies:', error);
      return false;
    }
  }

  /**
   * Navigate to a URL and verify we're authenticated
   */
  async navigateAndAuthenticate(url) {
    try {
      console.log(`Navigating to: ${url}`);
      await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait a bit for any redirects
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check if we're still on the same domain
      const currentUrl = this.page.url();
      if (currentUrl.includes('login') || currentUrl.includes('signin')) {
        console.log('Authentication failed. Redirected to login page.');
        return false;
      }

      console.log('Navigation successful');
      return true;
    } catch (error) {
      console.error('Error during navigation:', error);
      return false;
    }
  }

  /**
   * Verify authentication by checking for elements that only appear when logged in
   */
  async verifyAuthentication() {
    try {
      // For debugging, you can uncomment the following line to see the page state
      // await this.page.screenshot({ path: 'debug-auth.png', fullPage: true });

      // Check for elements that should only be present when authenticated
      // This will need to be adjusted based on the actual website structure
      const pageContent = await this.page.content();

      // Check for indicators of authentication
      const authIndicators = [
        'user-menu',
        'profile',
        'logout',
        'account',
        'dashboard'
      ];

      // Check if we're still on the same lecture page (not redirected to login)
      const currentUrl = this.page.url();
      const isCorrectPage = currentUrl.includes('/courses/') && currentUrl.includes('/lectures/');

      // Look for any indicators in the page content
      const hasIndicators = authIndicators.some(indicator =>
        pageContent.toLowerCase().includes(indicator)
      );

      // For debugging, show what we found
      console.log('Current URL:', currentUrl);
      console.log('Is correct page format:', isCorrectPage);
      console.log('Has auth indicators:', hasIndicators);

      if (isCorrectPage || hasIndicators) {
        console.log('Authentication verified successfully');
        return true;
      } else {
        console.log('Authentication could not be verified');
        return false;
      }
    } catch (error) {
      console.error('Error verifying authentication:', error);
      return false;
    }
  }

  /**
   * Phase 1 main execution flow
   */
  async phase1(url) {
    console.log('=== Phase 1: Setup and Authentication ===');

    // Step 1: Initialize browser
    if (!await this.init()) {
      console.error('Phase 1 failed at browser initialization');
      return false;
    }

    // Step 2: Load cookies
    if (!await this.loadCookies()) {
      console.error('Phase 1 failed at cookie loading');
      await this.cleanup();
      return false;
    }

    // Step 3: Navigate to URL
    if (!await this.navigateAndAuthenticate(url)) {
      console.error('Phase 1 failed at navigation');
      await this.cleanup();
      return false;
    }

    // Step 4: Verify authentication
    if (!await this.verifyAuthentication()) {
      console.error('Phase 1 failed at authentication verification');
      await this.cleanup();
      return false;
    }

    console.log('Phase 1 completed successfully');
    return true;
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      console.log('Browser closed');
    }
  }
}

// Command line interface
async function main() {
  const args = process.argv.slice(2);
  const urlIndex = args.findIndex(arg => arg !== '--debug' && !arg.startsWith('--'));

  // Parse command line arguments
  const options = {
    debug: args.includes('--debug'),
    headless: !args.includes('--debug') // Debug mode implies headful browser
  };

  // Default URL for testing
  const url = urlIndex >= 0 ? args[urlIndex] : 'https://learn.cantrill.io/courses/1820301/lectures/41301611';

  // Create automator instance
  const automator = new TranscriptAutomator(options);

  // Run Phase 1
  const success = await automator.phase1(url);

  // Clean up
  await automator.cleanup();

  // Exit with appropriate code
  process.exit(success ? 0 : 1);
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Uncaught error:', error);
    process.exit(1);
  });
}

module.exports = TranscriptAutomator;
